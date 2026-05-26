---
name: frontend-state-management
description: Designs client-side state architecture across frameworks — local vs global, server-state vs client-state separation (React Query / SWR / TanStack Query), store shape (Redux / Zustand / Pinia / Svelte stores), selectors, and cache normalisation. Output: a state-shape decision plus the wiring code and a test pinning the boundary. Pulled by the `frontend` specialist. TRIGGER: "where should this state live", "local vs global state for X", "set up React Query / SWR / TanStack for X", "design the Zustand / Redux / Pinia store for X", "normalise the cache for X", "share filter state across X", "add selectors for X". DO NOT TRIGGER for: server-side data layer, schema, or query design (backend-data-layer — that's the source of truth; this is the client cache), API contract shape (backend-api-contract), React component internals / hooks (use `frontend-react`), bundler config (use `frontend-bundler-config`), accessibility (use `frontend-a11y`), React Native runtime stores (mobile-react-native).
when_to_use: The parent `frontend` specialist pulls this skill when the task requires deciding where state lives and how it is shaped, fetched, cached, and selected. Also fires on explicit user request.
type: specialist
---

# frontend-state-management

Implements `guild-plan.md §6.1` (frontend · state-management) under `§6.4` engineering principles: the right state lives in exactly one place, and the test pins which boundary owns it.

## What you do

Decide where each piece of state lives and how it is shaped, then wire it. The first call is always server-state vs client-state — they have different lifecycles and want different tools.

- Separate server-state (fetched, cacheable, can go stale) from client-state (UI, ephemeral). Don't hand-manage fetched data in a global store — let a query cache own it.
- Keep state local until two siblings need it; lift, then globalize, in that order — not the reverse.
- Choose by need: a query cache (React Query / SWR / TanStack Query) for server-state; a lightweight store (Zustand / Jotai / Pinia / Svelte stores) for shared client-state; Redux when its middleware and devtools discipline earn their weight.
- Normalize cached collections by id; read through memoized selectors so a change to one row doesn't re-render the list.
- Make cache invalidation explicit — keys, TTLs, and the mutations that trigger refetch.

## Output shape

A state-shape decision plus wiring:

1. **State-shape decision** — what's server-state, what's client-state, where each lives, and why.
2. **Store / query setup** — the wiring (provider, store, query client) as code.
3. **Selectors** — memoized accessors at the read sites.
4. **Invalidation plan** — cache keys and when they refetch or reset.
5. **Test** — pins the boundary (selector returns the derived value; cache invalidates on mutation).

## Anti-patterns

- Server data hand-managed in a global store — you reinvent caching, worse than the library.
- Everything global — every component re-renders on every unrelated change.
- Unmemoized selectors returning fresh object refs — defeats the framework's bail-out.
- No invalidation story — stale data after mutations, or a refetch-the-world hammer.
- Prop-drilling five levels deep when a store or context is the honest answer.
- Derivable state stored and kept in sync by hand — two sources of truth, guaranteed drift.

## Handoff

Return the state-shape decision and wiring to the invoking `frontend` specialist. The server contract behind the cache is `backend-api-contract` / `backend-data-layer` territory — this skill owns the client cache, not the source of truth. Component internals consuming the state chain into `frontend-react`. This skill does not dispatch.
