---
name: frontend-a11y
description: Implements web accessibility to an explicit baseline (WCAG AA public, operator-tool internal) — semantic HTML first, ARIA only when needed, keyboard navigation, focus management, and screen-reader behaviour. Output: a code change plus an axe / Lighthouse a11y measurement before vs after. Pulled by the `frontend` specialist. TRIGGER: "make X keyboard-navigable", "fix the Lighthouse / axe a11y findings on X", "add ARIA / roles / labels to X", "manage focus in the X modal", "is X screen-reader accessible", "add a skip link / focus trap to X". DO NOT TRIGGER for: technical SEO audits, crawlability, meta / structured-data (seo-technical-audit — seo diagnoses, frontend implements the fix), UI microcopy / label wording (copywriter-product-microcopy — frontend wires the strings in), React component internals (use `frontend-react`), state wiring (use `frontend-state-management`), bundler config (use `frontend-bundler-config`), React Native a11y (mobile-react-native — distinct runtime).
when_to_use: The parent `frontend` specialist pulls this skill when the task requires accessibility implementation — keyboard, focus, ARIA, semantic markup, or screen-reader behaviour. Also fires on explicit user request.
type: specialist
---

# frontend-a11y

Implements `guild-plan.md §6.1` (frontend · a11y) under `§6.4` engineering principles: accessibility is verified by an axe / Lighthouse run plus a keyboard-only pass — it is measured, not asserted.

## What you do

Make the surface usable without a mouse and legible to a screen reader, against a stated baseline. Reach for the platform before reaching for ARIA.

- Use semantic HTML first (`button`, `nav`, `label`, `<dialog>`, headings in order); ARIA is a patch for when no native element fits.
- Make every interactive element reachable and operable by keyboard, with a visible focus indicator.
- Manage focus on route change and on modal open/close — trap it where appropriate, restore it to the trigger on close.
- Pair every input with a programmatic label; give icon-only controls an accessible name.
- Respect `prefers-reduced-motion`; never convey meaning by color alone — pair it with text or shape.
- Verify with a screen reader and an automated tool against an explicit baseline (WCAG AA for public surfaces, operator-tool baseline for internal admin).

## Output shape

A code change plus its verification:

1. **Baseline** — which standard applies to this surface, and why.
2. **Code change** — semantic markup, ARIA where needed, focus management, keyboard handlers.
3. **Keyboard map** — tab order and shortcut behavior for the changed surface.
4. **Measurement** — axe / Lighthouse a11y score before vs after, plus a manual screen-reader note.
5. **Residual findings** — what's deferred and the rationale.

## Anti-patterns

- ARIA bolted onto a `<div onClick>` instead of using a `<button>` — reinvents a native element, badly.
- Keyboard traps, or focus that vanishes after a modal closes.
- Color-only state (red/green) with no text or icon backing it.
- `aria-label` that contradicts the visible label, or redundant roles on already-semantic elements.
- "It passes axe" with no manual keyboard / screen-reader pass — automated tools catch only part of it.
- Stripping focus outlines for aesthetics with nothing to replace them.

## Handoff

Return the code change and a11y measurement to the invoking `frontend` specialist. Audit *diagnosis* of crawlability and structured data is `seo-technical-audit` territory — frontend implements the a11y fix, seo owns the SEO audit. Final label and string wording is `copywriter-product-microcopy`. This skill does not dispatch.
