# Guild docs-site URL placeholder

> **TODO (operator):** Once the website repo move and GitHub Pages URL are
> finalised, replace every occurrence of `<GUILD_DOCS_URL>` in this repo
> with the real base URL (e.g. `https://example.github.io/guild`) and delete
> this file.
>
> Find all occurrences:
> ```bash
> grep -r "GUILD_DOCS_URL" /path/to/plugin/
> ```

All in-repo references to the Guild documentation website use the
placeholder `<GUILD_DOCS_URL>` so that no URL is hardcoded before the
website repo and Pages domain are settled.

| Placeholder | Meaning |
|---|---|
| `<GUILD_DOCS_URL>` | Base URL of the Guild docs site (no trailing slash) |
| `<GUILD_DOCS_URL>/docs/<slug>` | A specific docs page, e.g. `/docs/architecture` |

The website source currently lives at `../website/src/content/docs/`
(separate repo, decision D-WEB-2).
