---
name: mobile-android-kotlin
description: Authors idiomatic Kotlin for Android (Jetpack Compose or View system, chosen by fit), with structured coroutines, Flow / StateFlow, and leak-safe context handling. Output: Kotlin source plus Gradle / manifest notes. Pulled by the `mobile` specialist. TRIGGER: "write the Android screen for X in Kotlin", "implement the Compose screen for X", "author the Android Fragment for X", "build the Android feature X", "Kotlin code for X", "add the Android-side implementation of X". DO NOT TRIGGER for: iOS Swift code (use `mobile-ios-swift`), React Native / cross-platform (use `mobile-react-native`), mobile performance profiling (use `mobile-performance-tuning`), backend API shape (backend-api-contract), design system tokens (frontend-design), CI / Play Store release wiring (devops-ci-cd-pipeline).
when_to_use: The parent `mobile` specialist pulls this skill when the task requires native Android implementation in Kotlin. Also fires on explicit user request.
type: specialist
---

# mobile-android-kotlin

Implements `guild-plan.md §6.1` (mobile · android-kotlin) under `§6.4` engineering principles: idiomatic Kotlin, structured concurrency via scoped coroutines, lifecycle-aware flows.

## What you do

Write Kotlin that respects Android lifecycles. Prefer Jetpack Compose for new UI; use the View system when interop, legacy screens, or custom drawing require it. Coroutines with proper scope (never `GlobalScope`) and Flow / StateFlow for reactive streams.

- Scope coroutines to `viewModelScope`, `lifecycleScope`, or `CoroutineScope(SupervisorJob() + dispatcher)` — never leak.
- Use `StateFlow` for UI state, `SharedFlow` for events; `LiveData` only when Java interop demands.
- Hold application context in singletons; never capture activity context in long-lived objects.
- Model UI state as a single immutable data class — one source of truth per screen.
- Use `Result` / sealed error types over exceptions for expected failures.
- Handle configuration changes correctly — ViewModel survives rotation.

## Output shape

Kotlin source plus build notes:

1. **Source** — one file per logical unit; follow Kotlin coding conventions.
2. **Previews / tests** — `@Preview` for Compose, instrumentation / unit tests for logic.
3. **Gradle notes** — dependencies added, minSdk / targetSdk impact, ProGuard / R8 rules.
4. **Manifest** — any permissions, content providers, services added.
5. **Accessibility** — TalkBack content descriptions, touch target sizes, contrast checks.

## Anti-patterns

- `GlobalScope.launch` — leaks coroutines beyond any lifecycle.
- Misusing LiveData (`postValue` in tight loops) or exposing mutable StateFlow.
- Capturing activity context in a singleton or static field — guaranteed leak.
- Blocking the main thread with `runBlocking` or synchronous network calls.
- `!!` non-null assertion on values that can legitimately be null.
- Massive activities / fragments — extract ViewModels and repository layers.

## Handoff

Return the Kotlin source paths and Gradle / manifest notes to the invoking `mobile` specialist. iOS parity chains into `mobile-ios-swift`; cross-platform into `mobile-react-native`. Performance work lives in `mobile-performance-tuning`. This skill does not dispatch.
