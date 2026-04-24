---
name: mobile-performance-tuning
description: Profiles and optimizes mobile apps — startup, scroll jank, memory, battery — with before/after metrics on real devices. Output: instrument plan, baseline, fix list, post-fix metrics. Pulled by the `mobile` specialist. TRIGGER: "profile the app's cold-start time", "the scroll is janky on X screen", "optimize memory on Y screen", "mobile performance audit of X", "why is the app slow on low-end devices", "reduce battery usage on X feature". DO NOT TRIGGER for: writing the feature in Swift (use `mobile-ios-swift`), Kotlin (use `mobile-android-kotlin`), or RN (use `mobile-react-native`); backend latency work (backend group); CI build-time optimization (devops-ci-cd-pipeline); observability of app telemetry in prod (devops-observability-setup); QA test-strategy definition (qa-test-strategy).
when_to_use: The parent `mobile` specialist pulls this skill when the task requires measuring and improving runtime performance of a mobile app. Also fires on explicit user request.
type: specialist
---

# mobile-performance-tuning

Implements `guild-plan.md §6.1` (mobile · performance-tuning) under `§6.4` engineering principles: measure first, optimize second; any speed-up without a before/after number is folklore.

## What you do

Pick the right instrument (Instruments / Xcode Organizer, Android Studio Profiler / Perfetto, Flipper, React Native Performance Monitor), capture a baseline on a real low-end device, ship the smallest fix that moves the metric, and confirm with a post-fix capture.

- Define the target metric up front: cold start (time-to-first-frame), scroll jank (p95 frame time), memory peak, steady-state CPU, battery per session.
- Test on real representative hardware — simulators hide thermal, GPU, and IO behavior.
- Reduce startup work: lazy-init SDKs, move heavy work off the main thread, trim launch-time DI.
- Scroll fixes: cell reuse, fixed row heights, off-screen prefetch, image decode off main.
- Memory: track retained heap over time, kill caches that never evict.
- Report before/after with the same device, OS, build flavor, and scenario — otherwise the comparison is noise.

## Output shape

A short report:

1. **Instrument plan** — which tool, what device, what scenario, what metric.
2. **Baseline** — captured traces / numbers with screenshots of the flame graph or trace.
3. **Fix list** — ordered, each with estimated impact and cost.
4. **Post-fix metrics** — same scenario, delta from baseline.
5. **Regression guard** — an automated perf test or a CI check to prevent bitrot.

## Anti-patterns

- Optimizing without measuring — random speculative changes without a baseline.
- Micro-benchmarks on a high-end device when users are on a Moto G — unrepresentative.
- Ignoring low-end devices entirely — median user, not p1 reviewer hardware.
- Fixing cold start while making warm start worse — track all scenarios you care about.
- Releasing perf wins with no regression test — the next feature undoes them silently.
- Optimizing the wrong layer — e.g. JS fixes when the bottleneck is native image decode.

## Handoff

Return the report path and the list of code changes (if any) to the invoking `mobile` specialist. Fix implementation typically chains to `mobile-ios-swift`, `mobile-android-kotlin`, or `mobile-react-native`. If the cause is server-side, handoff goes to the backend group. This skill does not dispatch.
