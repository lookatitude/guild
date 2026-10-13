# Root-cause tracing

A bug usually *manifests* deep in the call stack — `git init` running in the
wrong directory, a file written to the wrong path, a database opened with an
empty connection string. The instinct is to fix it where the error surfaces.
That fixes a symptom. **Trace backward through the call chain to the original
trigger, then fix at the source.**

Use this when the error happens deep in execution rather than at an entry
point, the stack trace shows a long call chain, it's unclear where the invalid
data originated, or you need to find which test/code path triggers the problem.

## The tracing process

1. **Observe the symptom.** e.g. `git init failed in /repo/packages/core`.
2. **Find the immediate cause** — the line that directly triggers it:
   `await execFileAsync('git', ['init'], { cwd: projectDir })`.
3. **Ask what called this**, and what value it passed:
   ```
   createSessionWorktree(projectDir, sessionId)
     ← Session.initializeWorkspace()
     ← Session.create()
     ← the test at Project.create()
   ```
4. **Keep tracing up.** `projectDir` was `''` (empty) — and an empty `cwd`
   resolves to `process.cwd()`, the source directory. That's the symptom's
   mechanism, not yet its origin.
5. **Find the original trigger.** The empty string came from a test that read
   `context.tempDir` before `beforeEach` populated it. *That* is the root
   cause.

## Adding instrumentation when you can't trace by hand

Log context **before** the dangerous operation, not after it fails:

```typescript
async function gitInit(directory: string) {
  console.error('DEBUG git init:', {
    directory,
    cwd: process.cwd(),
    nodeEnv: process.env.NODE_ENV,
    stack: new Error().stack,
  });
  await execFileAsync('git', ['init'], { cwd: directory });
}
```

Use `console.error` in tests (a logger may be suppressed). Capture and filter:
`npm test 2>&1 | grep 'DEBUG git init'`. Read the stack traces for the test
file name, the triggering line, and the pattern (same test? same parameter?).

## Finding which test pollutes shared state

When something appears during a run but you don't know which test created it,
bisect with `find-polluter.sh` in this directory — it runs the suite one file
at a time and stops at the first test that produces the unwanted file/state:

```bash
./find-polluter.sh '.git' 'src/**/*.test.ts'
```

## The principle

Once you've found the immediate cause, ask "can I trace one level up?" — if
yes, trace; if you've reached the source, fix there, then add validation at
each layer the bad data passed through (see `defense-in-depth.md`) so the bug
becomes impossible. **Never fix only where the error appears.** Fixing the
symptom leaves the trigger live to resurface elsewhere.

## Stack-trace tips

In tests use `console.error`, not a logger. Log *before* the operation.
Include directory, `cwd`, env vars, and timestamps. `new Error().stack`
captures the complete call chain at the point of logging.
