# Guild plugin modules

This tree is the source of truth for the plugin reorganization. Module
manifests define ownership, module workflows expose reusable implementation
APIs, and module `resources/` hold the canonical command, skill, agent, hook,
script, and MCP body files used by generated packages.

The existing top-level `commands/`, `skills/`, `agents/`, `hooks/`, `scripts/`,
and `mcp-servers/` trees remain for host compatibility. They are generated
mirrors of module resources, not the authoring surface.

Each module has a `module.manifest.json` using `guild.module_manifest.v1`.
Manifests declare ownership over existing neutral inventory ids:

- `commands`, `skills`, `agents`, `hooks`, `mcp_servers`, and `scripts` use
  inventory ids, not file paths.
- Prefix selectors are allowed only for stable families such as
  `scripts/learn/*` or specialist skill prefixes.
- Every live inventory id must be owned by exactly one module.
- Any implementation import from one `src/modules/<module>/` tree into another
  module must target that module's public `index.ts` and must be declared in
  the importing module's `depends_on` list.
- Each module must declare `implementation_mode`. `workflow-backed` modules must
  define TypeScript workflows and expose a public `index.ts`; `resource-only`
  modules intentionally own host-facing resources without module-local workflow
  code yet.
- Every module must keep its generated `resources/module-resources.json` and
  `.generated-by-guild-module-resources` marker present.
- A new feature should add or update one module manifest first, then wire its
  workflow/lifecycle slot through the existing surfaces.

Each module also has a generated `resources/` tree. `scripts/sync-module-resources.ts`
materializes the module's owned live resources from the neutral inventory into:

- `resources/commands/`
- `resources/skills/`
- `resources/agents/`
- `resources/hooks/`
- `resources/mcp_servers/`
- `resources/scripts/`

Each `resources/module-resources.json` records the source path, resource path,
and SHA-256 hash for the module's copied resources. `--check` mode verifies the
module-local copies are byte-identical to the current live surfaces.

Generated host packages consume these module resources for inventory-owned body
files. `build:hosts` first runs the module-resource check, then copies owned
commands, skills, agents, hooks, MCP declarations, and scripts from
`src/modules/*/resources` into the host-facing package paths. If a module
resource drifts from its recorded hash, package generation fails closed instead
of silently falling back to the top-level file.

The generated package runtime is smoke-tested for wrapper launchability. The
Codex, Pi, and Antigravity packages must execute their bundled `bin/guild-run`
entrypoint in `--dry-run` mode from the generated package directory. The
universal `.agents` package is a file-surface target, so its check verifies
`AGENTS.md` and the bundled Guild skill tree instead of pretending it is a
process launcher.

`npm run verify:host-packages` rebuilds the generated host packages and verifies
their manifests, marketplace wrappers, `.agents` file surface, bundled hook
runtime dependency, and Codex/Pi/Antigravity `guild-run --dry-run` wrapper
execution.

`npm run verify:installer` verifies the live `install.sh` dry-run path for every
supported host target: Claude Code CLI, Codex CLI, universal `.agents`, Pi CLI,
and Antigravity CLI. It runs with a minimal `PATH` so the proof does not depend
on local host binaries being installed, and it checks that dry-run rendering uses
the deterministic `<generated-at>` placeholder instead of a real timestamp.
Claude Code now follows the same generated-package path: the installer renders
`dist/claude-code`, validates it with `claude plugin validate`, and adds that
generated local marketplace before installing `guild@guild`.

`npm run verify:installer-execution` runs the same installer paths without
`--dry-run` against temporary recording binaries for `claude`, `codex`, `pi`,
and `agy`. That proves the real command branches execute and produce generated
install artifacts without mutating the user's actual host installations.

Claude's live install metadata can now be checked or synchronized from the same
module/inventory render:

- `npm run check:claude-install` verifies `.claude-plugin/plugin.json` and
  `.claude-plugin/marketplace.json` match the generated Claude render.
- `npm run sync:claude-install` updates those two live metadata files after the
  module-resource check passes.

This keeps the live Claude install metadata generated and drift-checked, while
the installer consumes the generated Claude package as its marketplace source.

Live body files can also be checked or synchronized from module resources:

- `npm run check:live-resources` verifies the host-facing command, skill, agent,
  hook, MCP, and script files match the module resource copies.
- `npm run sync:live-resources` copies module resources back to the host-facing
  paths after verifying each module resource still matches its
  `module-resources.json` hash.

This is the cutover mechanism for body files: old host-facing paths still exist
for host compatibility, but they are generated install surfaces rather than
hand-maintained source files.

Validation:

```bash
cd scripts
npm run check:modules -- --root ..
npm run sync:module-resources -- --root ..
npm run check:module-resources -- --root ..
npm run check:live-resources -- --root ..
npm run check:claude-install -- --root ..
npm run check:module-source-of-truth
npm run verify:host-packages
npm run verify:installer
npm run verify:installer-execution
node_modules/.bin/jest __tests__/module-ownership.test.ts --runInBand --watchman=false
node_modules/.bin/jest __tests__/module-resources.test.ts --runInBand --watchman=false
node_modules/.bin/jest __tests__/verify-installer.test.ts --runInBand --watchman=false
node_modules/.bin/jest __tests__/claude-host-adapter.test.ts --runInBand --watchman=false
```

This keeps the reorg enforceable: module ownership, declared dependency edges,
and public-only cross-module imports are validated; workflow modules must expose
public APIs; module-owned resource bodies are checked byte-for-byte; and
top-level compatibility mirrors are checked against module resources.

## Compatibility shims

During migration, stable inventory paths under `scripts/` may become thin shims
that import implementation from `src/modules/*`. Because generated host packages
bundle the `scripts/` tree, `scripts/build-host-packages.ts` must also bundle
`src/` anywhere it bundles scripts. Keep the focused Claude package test in
`scripts/__tests__/claude-host-adapter.test.ts` green before moving more runtime
code behind module-owned implementations.
