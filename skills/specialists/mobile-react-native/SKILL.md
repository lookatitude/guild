---
name: mobile-react-native
description: Authors React Native / Expo components with platform-aware behavior, minimal JS-bridge traffic, and native-module notes where required. Output: TypeScript source for the component plus notes on any native modules / platform code. Pulled by the `mobile` specialist. TRIGGER: "write the React Native screen for X", "build the Expo component for X", "author the RN feature for X", "cross-platform mobile screen for X", "implement X in React Native for iOS and Android", "RN component for X with platform-specific behavior". DO NOT TRIGGER for: pure iOS Swift (use `mobile-ios-swift`), pure Android Kotlin (use `mobile-android-kotlin`), performance profiling (use `mobile-performance-tuning`), backend API design (backend-api-contract), design system authoring (frontend-design), OTA update / EAS build infra (devops-ci-cd-pipeline).
when_to_use: The parent `mobile` specialist pulls this skill when the task requires cross-platform mobile implementation in React Native or Expo. Also fires on explicit user request.
type: specialist
---

# mobile-react-native

Implements `guild-plan.md §6.1` (mobile · react-native) under `§6.4` engineering principles: the JS thread is a scarce resource, and every bridge hop is paid in frames.

## What you do

Write RN / Expo that treats the bridge as the bottleneck it is. Keep renders pure and small, offload heavy work to native modules or worklets (Reanimated / Hermes), and handle platform differences explicitly rather than hoping one code path works.

- Use TypeScript with strict mode; `any` is a last resort.
- Prefer the New Architecture (TurboModules, Fabric) when the project already uses it; otherwise keep bridge calls batched and rare.
- Animate on the UI thread via Reanimated worklets — not via `setState` loops.
- Branch platform-specific behavior with `Platform.select` or `.ios.tsx` / `.android.tsx`, never with hidden conditionals.
- List rendering: `FlatList` / `FlashList` with stable keys, `getItemLayout`, and virtualization; avoid `ScrollView` for long lists.
- Handle permissions, back-button, safe-area, and keyboard behaviors per-platform explicitly.

## Output shape

TypeScript source plus native-module notes:

1. **Component(s)** — `.tsx` files, typed props, memoized where it pays off.
2. **Native modules** — any platform code (Swift / Kotlin / Objective-C++), with integration steps.
3. **Platform file pairs** — `.ios.tsx` / `.android.tsx` when divergence is real.
4. **Build notes** — Expo config plugins or bare-workflow Gradle / Podfile changes.
5. **Tests** — Jest + React Native Testing Library for logic, Detox / Maestro note for E2E if relevant.

## Anti-patterns

- Rendering on the JS thread when it should be a Reanimated worklet — drops frames.
- Excessive bridge traffic — per-frame messages or large JSON blobs over the bridge.
- Platform-specific bugs papered over with a silent `if (Platform.OS === 'ios')` buried in logic.
- `ScrollView` containing hundreds of items — kills memory on low-end Android.
- Inline anonymous components or un-memoized handlers inside hot lists.
- `any` spreading through props — types lose meaning.

## Handoff

Return the TS source paths and native-module notes to the invoking `mobile` specialist. Deep native work chains into `mobile-ios-swift` or `mobile-android-kotlin`. Performance work lives in `mobile-performance-tuning`. This skill does not dispatch.
