---
name: frontend-bundler-config
description: Configures the frontend build — Vite / Webpack / esbuild / Rollup: dev server, code splitting, tree shaking, asset handling, env-var injection, production optimisation, and bundle-size budgets. Output: a config diff plus a before/after measurement (bundle size, build time, dev-server start). Pulled by the `frontend` specialist. TRIGGER: "write the Vite config for X", "code-split the X route", "set up tree shaking / shrink the bundle for X", "configure the dev server / HMR for X", "wire env variables into the build", "set a bundle-size budget for X", "why is the production build so large". DO NOT TRIGGER for: CI/CD pipelines, deploy steps, release automation (devops-ci-cd-pipeline — frontend writes the build script, devops wires the pipeline), infra / CDN provisioning (devops-infrastructure-as-code), React component authoring (use `frontend-react`), state / data-fetching (use `frontend-state-management`), accessibility (use `frontend-a11y`), React Native / Expo / EAS builds (mobile-react-native).
when_to_use: The parent `frontend` specialist pulls this skill when the task requires bundler or dev-server configuration, code splitting, or bundle-size work. Also fires on explicit user request.
type: specialist
---

# frontend-bundler-config

Every config change ships with a measurement — bundle bytes, build seconds, or dev-server start — proving it helped.

## What you do

Tune the frontend build against a number, not a hunch. Take a measurement first, change one thing, measure again.

- Start from data: run the bundle analyzer or capture build timing before touching config.
- Code-split at route and heavy-dependency boundaries; lazy-load what's below the fold or behind a click.
- Make tree shaking actually work — ship ESM, keep `sideEffects` honest in `package.json`, and avoid barrel files that pull in the world.
- Hash asset filenames for cache-busting; inline only the smallest assets.
- Inject env vars at build time from a documented allowlist; never let a secret reach the client bundle — everything shipped is public.
- Set a bundle-size budget and make the build fail when it's exceeded.

## Output shape

A config diff plus its measurement:

1. **Config diff** — the Vite / Webpack / esbuild / Rollup change.
2. **Measurement** — before/after bundle size, build time, or dev-server start.
3. **Split points** — which chunks were carved out and what triggers their load.
4. **Env-var contract** — the build-time variable allowlist (and what's deliberately excluded).
5. **Budget** — the size budget and where it's enforced in the build.

## Anti-patterns

- A config change with no before/after number — you can't tell if it helped or hurt.
- Secrets in client-exposed env vars — anything in the bundle is readable by anyone.
- Barrel files or CommonJS interop silently defeating tree shaking.
- One monolithic chunk — no splitting, slow first paint, nothing cacheable in isolation.
- Unbounded bundle growth — no budget, no alarm until users complain about load time.
- Over-splitting into hundreds of micro-chunks — a request waterfall that's slower than one chunk.

## Handoff

Return the config diff and measurement to the invoking `frontend` specialist. The CI step that runs this build and enforces the budget gate is `devops-ci-cd-pipeline` territory — frontend writes the build script, devops wires the pipeline. This skill does not dispatch.
