# wiki revert — undo one harvest

`maintain wiki revert <harvest_id>` replays the `guild.harvest_journal.v1` inverse
for one harvest op (R54 / KTD39). Harvest is the only automatic wiki writer, so
this is the only undo an operator needs for an unattended durable write.

## What it restores

- the decision page, back to the bytes it had before the op (a page that did not
  exist before is **deleted**, not emptied — a reverted page must stop being
  recallable);
- the project playbook span the same op replaced;
- the BM25 index for both.

It does **not** touch git. Revert works on a dirty tree and never commits, in
either direction.

## Run it

```bash
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/runtime/scripts/wiki-revert.js" --list --run <run-id>
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/runtime/scripts/wiki-revert.js" <harvest_op_id> --run <run-id>
```

`--list` prints each op's id, status, trigger and page path. Take the id from
there, or from the harvest report T0 surfaced after the promote.

## When it refuses

- **unknown op id** — the journal has no such op in this run. Harvest journals are
  per-run; check `--list` on the run that did the promote.
- **no recorded inverse** — the op never reached the write step, so there is
  nothing to undo. A `refused` op is already a no-op.
- **partial restore** — the output names the files it did restore. Re-running is
  safe: the inverse is the same bytes every time.

## What it is not

Not a rollback of a skill body (`maintain rollback <skill>`), not a git revert, and
not a way to delete a wiki page an operator wrote by hand. It only undoes what
harvest did.
