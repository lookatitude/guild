---
name: guild-finish-branch
description: "Guild's branch-completion discipline — once work is done and tests pass, present clear integration options (merge, PR, keep, discard) and execute the chosen one safely, then clean up the worktree. Chained off guild:execute-plan after all lanes report DONE and guild:verify-done is green. TRIGGER on \"we're done — what next\", \"merge this back\", \"open a PR for this branch\", \"wrap up the branch\", \"how do we integrate this\". DO NOT TRIGGER until tests pass and the review/verify gates are clear, nor for creating the isolated workspace in the first place (that is guild:worktrees)."
when_to_use: "Final step after guild:verify-done passes — to integrate or retire a completed branch and clean up its worktree."
type: meta
---

# Finishing a branch

Complete development work by verifying tests, presenting clear options,
executing the chosen workflow, and cleaning up. The shape is fixed:
**verify tests → present options → execute the choice → clean up the
worktree.** State the intent when you start: "Finishing this branch."

Respect Guild's branch + PR discipline — when the consuming repo forbids
direct commits to its integration branch (e.g. this repo's `main`), the only
valid integration paths are "create a PR" or "keep as-is"; surface that
constraint rather than offering a local merge that the repo's hooks will
refuse.

## Step 1 — verify tests

Run the project's test suite first. **If anything fails, stop** — show the
failures and report that merge/PR cannot proceed until they pass. Do not
advance to Step 2 on a red suite. (When chained after `guild:verify-done`,
this is a fast re-confirmation, not the first run.)

## Step 2 — determine the base branch

```bash
git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null
```

If ambiguous, ask: "This branch split from `main` — correct?"

## Step 3 — present exactly these four options

```
Implementation complete. What would you like to do?
1. Merge back to <base-branch> locally
2. Push and create a Pull Request
3. Keep the branch as-is (handle it later)
4. Discard this work
```

Keep them concise — no extra explanation. (If the repo bars direct
integration-branch commits, mark option 1 as unavailable and say why.)

## Step 4 — execute the choice

- **1 — Merge locally:** `git checkout <base>` → `git pull` → `git merge
  <feature>` → run tests on the merged result → if green, `git branch -d
  <feature>`. Then clean up the worktree (Step 5).
- **2 — Push + PR:** `git push -u origin <feature>`, then `gh pr create` with
  a Summary (2–3 bullets) and a Test Plan. Then clean up the worktree.
- **3 — Keep as-is:** report "Keeping branch `<name>`, worktree preserved at
  `<path>`." Do **not** clean up the worktree.
- **4 — Discard:** require typed confirmation first —
  ```
  This permanently deletes branch <name>, its commits <list>, and the worktree at <path>.
  Type 'discard' to confirm.
  ```
  Only on exact `discard`: `git checkout <base>` → `git branch -D <feature>`.
  Then clean up the worktree.

## Step 5 — clean up the worktree

For options 1, 2, and 4, if the current branch is checked out in a worktree
(`git worktree list | grep "$(git branch --show-current)"`), remove it:
`git worktree remove <path>`. For option 3, keep the worktree.

| Option | Merge | Push | Keep worktree | Remove branch |
|--------|:-----:|:----:|:-------------:|:-------------:|
| 1 Merge locally | ✓ | – | – | ✓ |
| 2 Create PR | – | ✓ | ✓ | – |
| 3 Keep as-is | – | – | ✓ | – |
| 4 Discard | – | – | – | ✓ (force) |

## Red flags

**Never** proceed with failing tests, merge without verifying tests on the
merged result, delete work without typed confirmation, or force-push without
an explicit request. **Always** verify tests before offering options, present
exactly the four options, get typed confirmation for option 4, and clean up
the worktree only for options 1 and 4.

## Integration

- **Chained from `guild:execute-plan`** after all lanes/batches complete (both
  subagent and agent-team backends).
- **Pairs with `guild:worktrees`** — cleans up the worktree that skill created.
- **Gated by `guild:verify-done`** — only finish a branch the done-gate passed.
