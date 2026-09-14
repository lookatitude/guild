# Defense-in-depth validation

When you fix a bug caused by invalid data, validating in one place feels
sufficient. It isn't — that single check is bypassed by a different code path,
a refactor, or a mock. **Validate at every layer the data passes through, so
the bug becomes structurally impossible**, not merely fixed in one spot.

Single validation says "we fixed the bug." Multiple layers say "we made the
bug impossible." Each layer catches what the others miss: entry validation
catches most bad input, business-logic checks catch edge cases, environment
guards prevent context-specific danger, and debug instrumentation helps when
all else fails.

## The four layers

**1 — Entry-point validation.** Reject obviously invalid input at the API
boundary.

```typescript
function createProject(name: string, workingDirectory: string) {
  if (!workingDirectory?.trim()) throw new Error('workingDirectory cannot be empty');
  if (!existsSync(workingDirectory)) throw new Error(`does not exist: ${workingDirectory}`);
  if (!statSync(workingDirectory).isDirectory()) throw new Error(`not a directory: ${workingDirectory}`);
}
```

**2 — Business-logic validation.** Ensure the data makes sense for *this*
operation.

```typescript
function initializeWorkspace(projectDir: string) {
  if (!projectDir) throw new Error('projectDir required for workspace initialization');
}
```

**3 — Environment guards.** Refuse dangerous operations in specific contexts.

```typescript
async function gitInit(directory: string) {
  if (process.env.NODE_ENV === 'test') {
    const dir = normalize(resolve(directory));
    if (!dir.startsWith(normalize(resolve(tmpdir())))) {
      throw new Error(`Refusing git init outside the temp dir during tests: ${directory}`);
    }
  }
}
```

**4 — Debug instrumentation.** Capture context for forensics (directory,
`cwd`, stack) before the operation runs.

## Applying the pattern

When you find a bug: trace the data flow (where the bad value originates and
where it's used), map every checkpoint the data passes through, add validation
at each of the four layers, then test each layer independently — deliberately
bypass layer 1 and confirm layer 2 catches it. All four layers earn their
place: different code paths bypass entry validation, mocks bypass
business-logic checks, platform edge cases need environment guards, and debug
logging reveals structural misuse the others let through. Don't stop at one
validation point.
