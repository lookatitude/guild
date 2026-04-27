import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFetch } from "../hooks/useFetch";

// Minimal Promise<Response> deferred — lets a test resolve a fetch on demand
// so we can simulate a stale-race.
function deferredResponse() {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("useFetch — abort and lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns idle when url is null", () => {
    const { result } = renderHook(() => useFetch<{ ok: boolean }>(null));
    expect(result.current.status).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });

  it("transitions loading → success and parses JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const { result } = renderHook(() => useFetch<{ ok: boolean }>("/x"));
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.data).toEqual({ ok: true });
  });

  it("aborts the previous request when the URL changes (race-stale guard)", async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    let call = 0;
    const fetchSpy = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const onAbort = () => reject(new DOMException("aborted", "AbortError"));
          init?.signal?.addEventListener("abort", onAbort);
          if (call++ === 0) {
            first.promise.then(resolve);
          } else {
            second.promise.then(resolve);
          }
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { result, rerender } = renderHook(({ url }) => useFetch<{ id: number }>(url), {
      initialProps: { url: "/a" },
    });
    expect(result.current.status).toBe("loading");
    rerender({ url: "/b" });
    // Now resolve the *first* request — it must NOT clobber the in-flight second.
    await act(async () => {
      first.resolve(
        new Response(JSON.stringify({ id: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      // Yield so the .then chain runs.
      await Promise.resolve();
    });
    expect(result.current.data).toBeUndefined();

    // Resolve the second — that one should win.
    await act(async () => {
      second.resolve(
        new Response(JSON.stringify({ id: 2 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.data).toEqual({ id: 2 });
  });

  it("surfaces non-2xx responses as an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "bad input" }), {
          status: 400,
          statusText: "Bad Request",
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const { result } = renderHook(() => useFetch<{ ok: boolean }>("/bad"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.message).toMatch(/HTTP 400/);
    expect(result.current.error?.message).toMatch(/bad input/);
  });
});
