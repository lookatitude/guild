---
name: mobile-ios-swift
description: Authors idiomatic Swift for iOS (SwiftUI or UIKit, chosen by target version and fit), with Swift Concurrency, proper main-actor isolation, and no force-unwraps. Output: Swift source files plus a build-notes section for SPM / Xcode integration. Pulled by the `mobile` specialist. TRIGGER: "write the iOS screen for X in Swift", "implement the SwiftUI view for X", "author the UIKit controller for X", "build the iOS feature X", "Swift code for X", "add the iOS-side implementation of X". DO NOT TRIGGER for: Android code (use `mobile-android-kotlin`), React Native / cross-platform (use `mobile-react-native`), mobile performance profiling (use `mobile-performance-tuning`), backend API contract (backend-api-contract), design system visual spec (frontend-design), CI/CD for the iOS build (devops-ci-cd-pipeline).
when_to_use: The parent `mobile` specialist pulls this skill when the task requires native iOS implementation in Swift. Also fires on explicit user request.
type: specialist
---

# mobile-ios-swift

Implements `guild-plan.md §6.1` (mobile · ios-swift) under `§6.4` engineering principles: idiomatic Swift, compiler-enforced safety, and concurrency that the language actually tracks.

## What you do

Write Swift that the compiler helps keep correct. Pick SwiftUI when the minimum deployment target allows and the screen is data-driven; fall back to UIKit when custom transitions, legacy integration, or fine control demand it. Use Swift Concurrency (`async/await`, actors) rather than GCD unless interop requires it.

- Prefer `let`, value types, and protocol-oriented composition over inheritance.
- Use optional binding (`if let`, `guard let`) and typed throws — `!` is a smell.
- Mark UI work `@MainActor`; keep I/O off the main thread with `Task.detached` or `async` functions.
- Manage references: `[weak self]` in closures that outlive the owner, break retain cycles explicitly.
- Use structured concurrency (`TaskGroup`, `async let`) for parallel work; cancel cooperatively.
- Accessibility first: `accessibilityLabel`, Dynamic Type, VoiceOver checked.

## Output shape

Swift source files plus a short build note:

1. **Source** — one file per logical unit; follow Apple's API Design Guidelines.
2. **Previews** — `#Preview` for SwiftUI, snapshot tests for UIKit.
3. **Build notes** — SPM dependency additions, minimum iOS target, Xcode scheme impact.
4. **Tests** — XCTest file exercising the non-UI logic.
5. **Accessibility** — a short checklist pass (labels, traits, Dynamic Type).

## Anti-patterns

- Force-unwraps (`!`) and forced casts (`as!`) in production paths.
- Retain cycles in `self`-capturing closures (timers, Combine sinks, callbacks).
- Main-thread blocking: `DispatchQueue.main.sync`, disk / network on UI calls.
- `@ObservedObject` on a model the view owns — use `@StateObject`.
- Massive view controllers / massive views — extract models and view models.
- Swallowed errors with `try?` where a real error path exists.

## Handoff

Return the Swift source paths and build notes to the invoking `mobile` specialist. If the feature needs Android parity, the mobile agent chains into `mobile-android-kotlin`; for cross-platform, `mobile-react-native`. Performance tuning lives in `mobile-performance-tuning`. This skill does not dispatch.
