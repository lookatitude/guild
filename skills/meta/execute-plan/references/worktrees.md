---
name: guild-worktrees
description: "Guild's git-worktree isolation discipline — create an isolated worktree with deterministic directory selection and safety verification so a lane runs on a clean tree without disturbing the user's current checkout. Invoked by guild:execute-plan before running implementation lanes and paired with guild:finish-branch for cleanup. TRIGGER on \"set up an isolated workspace\", \"use a worktree for this\", \"branch needs its own checkout\", \"isolate this experiment\". DO NOT TRIGGER for work that intentionally mutates the current branch in place, or for cleaning up a finished branch (that is guild:finish-branch)."
when_to_use: "At the start of an isolated implementation pass, and whenever a lane needs a clean tree separate from the user's working checkout."
type: meta
---

# Git worktrees

Git worktrees give you isolated checkouts that share one repository, so a lane
can work on its own branch without switching or disturbing the user's current
state. The discipline is simple: **deterministic directory selection + safety
verification = reliable isolation**. Skipping either is how worktree contents
end up tracked in the repo or how a lane stomps on uncommitted work.

State the intent when you start: "Setting up an isolated worktree for this
work."

## Directory selection — in priority order

1. **An existing worktree directory.** Check for `.worktrees/` (preferred,
   hidden) then `worktrees/`. If both exist, `.worktrees/` wins. Use what's
   already there.
2. **A `CLAUDE.md` preference.** `grep -i "worktree.*director" CLAUDE.md` — if
   a location is specified, use it without asking.
3. **Ask the user**, only when neither exists:
   ```
   No worktree directory found. Where should I create worktrees?
   1. .worktrees/ (project-local, hidden)
   2. ~/.guild/worktrees/<project-name>/ (global, outside the repo)
   ```

## Safety verification

**Project-local (`.worktrees/` or `worktrees/`):** the directory MUST be
git-ignored before you create a worktree inside it — otherwise the worktree's
contents get tracked and pollute `git status`.

```bash
git check-ignore -q .worktrees 2>/dev/null || git check-ignore -q worktrees 2>/dev/null
```

If it is **not** ignored, fix it immediately: add the line to `.gitignore`,
commit that, then proceed.

**Global (`~/.guild/worktrees/`):** outside the repo entirely — no
`.gitignore` check needed.

## Creation

```bash
project=$(basename "$(git rev-parse --show-toplevel)")
# path = "$LOCATION/$BRANCH_NAME" (project-local)
#     or "~/.guild/worktrees/$project/$BRANCH_NAME" (global)
git worktree add "$path" -b "$BRANCH_NAME"
cd "$path"
```

Then **auto-detect and run project setup** from the files present — don't
hardcode one toolchain: `package.json` → `npm install`; `Cargo.toml` →
`cargo build`; `requirements.txt` → `pip install -r`; `pyproject.toml` →
`poetry install`; `go.mod` → `go mod download`.

**Verify a clean baseline** by running the project's test command
(`npm test` / `cargo test` / `pytest` / `go test ./...`). If tests fail,
report the failures and ask whether to proceed or investigate — a dirty
baseline makes it impossible to tell new bugs from pre-existing ones. If they
pass, report ready: location, test count, the feature about to be built.

## Quick reference

| Situation | Action |
|-----------|--------|
| `.worktrees/` exists | Use it (verify ignored) |
| `worktrees/` exists | Use it (verify ignored) |
| Both exist | Use `.worktrees/` |
| Neither exists | Check `CLAUDE.md` → ask the user |
| Directory not ignored | Add to `.gitignore` + commit, then proceed |
| Baseline tests fail | Report + ask before proceeding |
| No recognised project file | Skip dependency install |

## Red flags

**Never** create a project-local worktree without verifying it's ignored, skip
the baseline test run, proceed past failing baseline tests without asking, or
assume the directory location when it's ambiguous. **Always** follow the
priority order, verify the ignore for project-local dirs, auto-detect setup,
and confirm a clean baseline.

## Integration

- **`guild:execute-plan`** creates an isolated worktree before running an
  implementation lane (covering both subagent and agent-team backends). Under
  the dispatch ladder (`agent_mode`), agent-team and isolated-agent backends
  run lanes in their own worktrees by construction.
- **`guild:finish-branch`** is the cleanup pair — it removes the worktree this
  skill created once the work is integrated or discarded.
