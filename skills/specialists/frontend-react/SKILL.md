---
name: frontend-react
description: Authors React components with disciplined hooks, Suspense and error boundaries, and justified memoization — render-cost reasoning over premature optimization. Output: TypeScript/JSX component source plus a component test where logic is non-trivial. Pulled by the `frontend` specialist. TRIGGER: "build the React component for X", "write the X view in React", "wrap X in a Suspense boundary", "add an error boundary around X", "why is this React component re-rendering", "should I memoize X / useMemo here", "author the hook for X". DO NOT TRIGGER for: React Native / Expo screens (use `mobile-react-native` — distinct runtime), store / server-state wiring (use `frontend-state-management`), Vite/Webpack/esbuild config (use `frontend-bundler-config`), keyboard / ARIA / focus work (use `frontend-a11y`), API or data-layer shape (backend-api-contract / backend-data-layer), test-suite strategy (qa-test-strategy), UI / visual / brand design (architect-systems-design — no visual-design specialist yet).
when_to_use: The parent `frontend` specialist pulls this skill when the task requires React-specific component authoring — hooks, boundaries, memoization, and JSX structure. Also fires on explicit user request.
type: specialist
---

# frontend-react

A component is correct when its render output is a pure function of props and state, and the cheapest version that passes its component test ships.

## What you do

Write React that renders predictably and cheaply. Keep components small, push state to the lowest owner that needs it, and place boundaries at the seams where data and routes actually fail — not sprinkled per component.

- Call hooks unconditionally at the top level; keep dependency arrays complete and honest — a lie there is a stale-closure bug.
- Place `Suspense` and error boundaries at data-fetch and route seams, where a single failure should degrade one region, not blank the page.
- Memoize (`useMemo` / `useCallback` / `React.memo`) only after a render-cost reason exists — profile first; premature memoization is noise that hides bugs.
- Lift state no higher than the lowest common ancestor that reads it; derive values during render instead of storing and syncing them.
- Reserve effects for synchronizing with external systems; an effect that only computes derived state is a smell.
- Type props explicitly; `any` is a last resort.

## Output shape

TypeScript/JSX source plus tests:

1. **Component(s)** — `.tsx` files, typed props, memoized only where it pays off.
2. **Hooks** — custom hooks extracted when logic is reused or worth testing in isolation.
3. **Boundaries** — `Suspense` / error-boundary placement at the right seam, with fallback UI.
4. **Tests** — React Testing Library for non-trivial logic, asserting behavior not implementation.
5. **Render-cost note** — when memoization was added, the measurement that justified it.

## Anti-patterns

- Conditional hooks or incomplete dependency arrays — stale closures, missed updates, crashes.
- Premature memoization — `useMemo` everywhere with no measured win; adds surface for bugs.
- Effects that derive state computable during render — needless re-render cycles.
- One giant component owning all state — re-renders the whole tree on every keystroke.
- Missing error / `Suspense` boundaries at data seams — one failed fetch blanks the screen.
- `any`-typed props — types stop meaning anything downstream.

## Handoff

Return component paths and tests to the invoking `frontend` specialist. State that outgrows local hooks chains into `frontend-state-management`; build / code-splitting concerns into `frontend-bundler-config`; keyboard, ARIA, and focus work into `frontend-a11y`. This skill does not dispatch.
