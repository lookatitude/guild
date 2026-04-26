import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteSourceDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(siteSourceDir, "../..");
const siteRoot = path.join(repoRoot, "docs/website");

const githubIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.48 2 2 6.59 2 12.26c0 4.52 2.87 8.36 6.84 9.72.5.1.68-.22.68-.49v-1.9c-2.78.62-3.37-1.22-3.37-1.22-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.86.09-.67.35-1.12.64-1.38-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.35 9.35 0 0 1 12 7c.85 0 1.71.12 2.51.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.94.68 1.9v2.79c0 .27.18.59.69.49A10.16 10.16 0 0 0 22 12.26C22 6.59 17.52 2 12 2Z"/></svg>`;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function truncate(value, limit = 220) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}...` : text;
}

function publicDescription(value, limit = 220) {
  return truncate(String(value ?? "").split(" TRIGGER")[0].split(" DO NOT TRIGGER")[0], limit);
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const data = {};
  const lines = match[1].split("\n");
  let listKey = null;

  for (const line of lines) {
    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listItem && listKey) {
      data[listKey].push(cleanScalar(listItem[1]));
      continue;
    }

    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;

    const [, key, rawValue] = pair;
    if (rawValue === "") {
      data[key] = [];
      listKey = key;
    } else {
      data[key] = cleanScalar(rawValue);
      listKey = null;
    }
  }

  return data;
}

function cleanScalar(value) {
  return value.replace(/^["']|["']$/g, "").trim();
}

async function readText(file) {
  return fs.readFile(path.join(repoRoot, file), "utf8");
}

async function listFiles(dir, predicate) {
  const absolute = path.join(repoRoot, dir);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(relative, predicate));
    } else if (!predicate || predicate(relative)) {
      files.push(relative);
    }
  }

  return files.sort();
}

function commandDisplay(file, name) {
  if (name === "guild") return "/guild";
  return `/${name.replace(/^guild-/, "guild:")}`;
}

function skillTier(file) {
  const [, tier] = file.split(path.sep);
  return tier;
}

async function loadCatalog() {
  const commandFiles = await listFiles("commands", (file) => file.endsWith(".md"));
  const agentFiles = await listFiles("agents", (file) => file.endsWith(".md"));
  const skillFiles = await listFiles("skills", (file) => file.endsWith("SKILL.md"));

  const commands = await Promise.all(commandFiles.map(async (file) => {
    const fm = parseFrontmatter(await readText(file));
    return {
      file,
      name: fm.name,
      display: commandDisplay(file, fm.name),
      argumentHint: fm["argument-hint"] || "",
      tools: fm["allowed-tools"] || "",
      description: publicDescription(fm.description, 260),
    };
  }));

  const agents = await Promise.all(agentFiles.map(async (file) => {
    const fm = parseFrontmatter(await readText(file));
    return {
      file,
      name: fm.name,
      model: fm.model || "",
      tools: fm.tools || "",
      skills: Array.isArray(fm.skills) ? fm.skills : [],
      description: publicDescription(fm.description, 280),
    };
  }));

  const skills = await Promise.all(skillFiles.map(async (file) => {
    const fm = parseFrontmatter(await readText(file));
    const dir = path.dirname(file);
    return {
      file,
      dir,
      tier: skillTier(file),
      name: fm.name || path.basename(dir),
      type: fm.type || skillTier(file),
      whenToUse: publicDescription(fm.when_to_use || fm.description, 260),
      description: publicDescription(fm.description, 280),
    };
  }));

  return { commands, agents, skills };
}

function href(prefix, target) {
  if (!target) return prefix || "./";
  return `${prefix}${target}`;
}

function layout({ title, description, canonicalPath, active, prefix = "", body, pageType = "website" }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${escapeHtml(description)}">
    <meta name="theme-color" content="#17130f">
    <meta name="color-scheme" content="dark">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="https://lookatitude.github.io/guild/${canonicalPath}">
    <meta property="og:type" content="${pageType}">
    <meta property="og:url" content="https://lookatitude.github.io/guild/${canonicalPath}">
    <meta property="og:site_name" content="Guild">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:image" content="https://lookatitude.github.io/guild/assets/og-image.png">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="https://lookatitude.github.io/guild/assets/twitter-card.png">
    <link rel="icon" href="${href(prefix, "assets/favicon.svg")}" type="image/svg+xml">
    <link rel="icon" href="${href(prefix, "assets/favicon-32.png")}" type="image/png" sizes="32x32">
    <link rel="apple-touch-icon" href="${href(prefix, "assets/apple-touch-icon.png")}">
    <link rel="manifest" href="${href(prefix, "assets/site.webmanifest")}">
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="${href(prefix, "styles.css")}">
  </head>
  <body>
    <header class="site-header">
      <div class="nav-shell">
        <a class="brand" href="${href(prefix, "")}" aria-label="Guild home">
          <img src="${href(prefix, "assets/guild-logo.svg")}" alt="" width="38" height="38">
          <span>Guild</span>
        </a>
        <nav aria-label="Primary navigation">
          ${navLink(prefix, "", "Home", active === "home")}
          ${navLink(prefix, "docs/", "Docs", active === "docs")}
          ${navLink(prefix, "reference/", "Reference", active === "reference")}
          ${navLink(prefix, "use-cases/url-shortener-e2e.html", "Use case", active === "use-case")}
          <a class="icon-link" href="https://github.com/lookatitude/guild" aria-label="GitHub repository">${githubIcon}</a>
        </nav>
      </div>
    </header>
${body}
    <footer class="site-footer">
      <div class="nav-shell">
        <span>Guild for Claude Code</span>
        <a href="https://lookatitude.com">Created by Lookatitude</a>
      </div>
    </footer>
  </body>
</html>
`;
}

function navLink(prefix, target, label, active) {
  return `<a href="${href(prefix, target)}"${active ? ' aria-current="page"' : ""}>${label}</a>`;
}

function renderHome(catalog) {
  const body = `    <main id="top">
      <section class="hero">
        <div class="hero-shell">
          <div class="hero-copy">
            <div class="hero-title">
              <img src="assets/guild-logo.svg" alt="" width="76" height="76">
              <h1>Guild</h1>
            </div>
            <p class="eyebrow">Claude Code plugin</p>
            <p class="lede">Self-evolving specialist agent teams that plan carefully, execute autonomously, and preserve project memory over time.</p>
            <div class="hero-actions">
              <a class="button primary" href="#install">Get started</a>
              <a class="button secondary" href="docs/">Read the docs</a>
            </div>
          </div>
          <aside class="command-card" aria-label="Guild quick command">
            <div class="terminal-bar"><span></span><span></span><span></span></div>
            <pre><code>/guild Build the feature, test it, update docs, and draft launch copy.</code></pre>
            <p>Guild asks the planning questions first, composes the right specialists, then runs the work through scoped context bundles.</p>
          </aside>
        </div>
      </section>

      <section class="quickstart" id="install">
        <div class="section-shell">
          <div class="section-heading">
            <p class="eyebrow">Quick start</p>
            <h2>Install, run, approve the plan</h2>
            <p>Guild becomes autonomous after the planning contract is approved. The first few minutes are where it asks the important questions.</p>
          </div>
          <div class="setup-grid">
            <article class="setup-step"><span>1</span><h3>Install the plugin</h3><pre><code>claude plugin marketplace add lookatitude/guild
claude plugin marketplace update guild
claude plugin install guild@guild --scope project
# Restart Claude Code before running /guild</code></pre></article>
            <article class="setup-step"><span>2</span><h3>Start with a real outcome</h3><pre><code>/guild Add usage-based billing, verify it, and write the release notes.</code></pre></article>
            <article class="setup-step"><span>3</span><h3>Use teams only when needed</h3><pre><code>export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1</code></pre></article>
          </div>
        </div>
      </section>

      <section class="feature-band" id="features">
        <div class="section-shell">
          <div class="section-heading">
            <p class="eyebrow">System shape</p>
            <h2>Planning discipline, specialist execution, durable memory</h2>
          </div>
          <div class="feature-grid">
            ${feature("Question-driven planning", "Goals, constraints, acceptance tests, non-goals, risk, and autonomy boundaries are captured before execution starts.")}
            ${feature("Specialist teams", `${catalog.agents.length} agents compose per task instead of all firing at once.`)}
            ${feature("Context bundles", "Each specialist gets a compact authoritative brief instead of a project-wide context dump.")}
            ${feature("Project memory", "Raw sources, decisions, standards, product notes, concepts, and source summaries live in .guild/.")}
            ${feature("Evidence gates", "Review and verification consume handoff receipts with changed files, assumptions, tests, citations, and risks.")}
            ${feature("Self-evolution", "Skills and specialists evolve through reflections, shadow mode, flip reports, and versioned rollback.")}
          </div>
        </div>
      </section>

      <section class="docs-band" id="site-map">
        <div class="section-shell">
          <div class="section-heading">
            <p class="eyebrow">Small static site</p>
            <h2>Organized for growth without a framework</h2>
            <p>The site is intentionally just a few public pages, generated by a dependency-free Node script. The reference page is rebuilt from the real plugin files.</p>
          </div>
          <div class="link-grid">
            ${linkPanel("Docs", "Guild operating guide", "Install, lifecycle, specialists, context assembly, wiki memory, evolution gates, and runtime state.", "docs/")}
            ${linkPanel("Reference", "Commands, agents, skills", `${catalog.commands.length} commands, ${catalog.agents.length} agents, and ${catalog.skills.length} skills mapped from the repo.`, "reference/")}
            ${linkPanel("Use case", "URL shortener E2E run", "The plan, what each agent actually did, final artifacts, tests, and reflection signal.", "use-cases/url-shortener-e2e.html")}
          </div>
        </div>
      </section>

      <section class="diagram-section" id="how">
        <div class="section-shell">
          <div class="section-heading">
            <p class="eyebrow">How it works</p>
            <h2>The Guild system</h2>
            <p>Guild gathers intent, selects the smallest useful team, assembles focused context, records durable memory, and evolves only when evidence proves the change belongs.</p>
          </div>
          <article class="diagram-feature">
            <div class="diagram-copy">
              <p class="eyebrow">System map</p>
              <h3>Architecture with clear ownership</h3>
              <p>The architecture map shows the boundary between the installed plugin, execution backends, specialist roster, and durable project state.</p>
              <ul class="diagram-points"><li>Commands orchestrate work without hiding state.</li><li>.guild/ keeps plans, memory, runs, and evolution auditable.</li></ul>
            </div>
            <figure><button class="diagram-open" type="button" data-full="diagrams/01-architecture.svg" aria-label="Open Guild architecture diagram"><img src="diagrams/01-architecture.svg" alt="Guild architecture diagram"></button></figure>
          </article>
        </div>
      </section>
    </main>
    <dialog class="image-modal" id="diagram-modal" aria-label="Diagram preview">
      <button class="modal-close" type="button" aria-label="Close diagram preview">Close</button>
      <img alt="">
    </dialog>
    <script>
      const diagramModal = document.querySelector("#diagram-modal");
      const modalImage = diagramModal.querySelector("img");
      const closeModal = diagramModal.querySelector(".modal-close");
      document.querySelectorAll(".diagram-open").forEach((button) => {
        button.addEventListener("click", () => {
          const image = button.querySelector("img");
          modalImage.src = button.dataset.full;
          modalImage.alt = image.alt;
          diagramModal.showModal();
        });
      });
      closeModal.addEventListener("click", () => diagramModal.close());
      diagramModal.addEventListener("click", (event) => {
        if (event.target === diagramModal) diagramModal.close();
      });
    </script>`;
  return layout({
    title: "Guild for Claude Code",
    description: "Guild is a Claude Code plugin for self-evolving specialist agent teams, durable project memory, autonomous execution, and evidence-backed documentation.",
    canonicalPath: "",
    active: "home",
    body,
  });
}

function feature(title, body) {
  return `<article><svg class="feature-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M7 9h18M7 16h12M7 23h8"/></svg><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p></article>`;
}

function linkPanel(label, title, body, url) {
  return `<a class="link-panel" href="${url}"><span class="why-index">${escapeHtml(label)}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p></a>`;
}

function renderDocs(catalog) {
  return layout({
    title: "Guild Documentation",
    description: "Guild documentation for installation, lifecycle, specialist teams, context assembly, project memory, and self-evolution.",
    canonicalPath: "docs/",
    active: "docs",
    prefix: "../",
    pageType: "article",
    body: `    <main>
      <section class="page-hero">
        <div class="section-shell">
          <p class="eyebrow">Documentation</p>
          <h1>Operate Guild with visible contracts</h1>
          <p class="lede">Install the plugin, approve the planning contract, let specialists work, then review receipts and evidence instead of reconstructing a hidden conversation.</p>
          <div class="hero-actions"><a class="button primary" href="#install">Install</a><a class="button secondary" href="../reference/">Open reference</a></div>
        </div>
      </section>
      <section class="doc-page">
        <div class="doc-layout">
          <aside class="content-nav" aria-label="Documentation sections">
            <a href="#install">Install</a><a href="#lifecycle">Lifecycle</a><a href="#specialists">Specialists</a><a href="#context">Context</a><a href="#memory">Memory</a><a href="#evolution">Evolution</a><a href="#state">Runtime state</a>
          </aside>
          <div class="doc-content">
            ${docSection("install", "Quick start", "Install Guild", `<p>Guild is installed through the Claude Code plugin marketplace. Restart Claude Code after installation so commands, skills, agents, hooks, and MCP servers hydrate in the next session.</p><pre><code>claude plugin marketplace add lookatitude/guild
claude plugin marketplace update guild
claude plugin install guild@guild --scope project
# Restart Claude Code before running /guild</code></pre><p>The experimental agent-team backend is opt-in. Use it only for tasks where teammates need direct coordination.</p><pre><code>export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1</code></pre>`)}
            ${docSection("lifecycle", "Workflow", "The `/guild` lifecycle", `<p>The lifecycle is contract-heavy at the beginning and evidence-heavy at the end. The user confirms after brainstorm, team-compose, and plan; post-plan execution runs with minimal interruption.</p><ol class="step-list"><li><strong>Brainstorm.</strong> Capture goals, audience, success criteria, non-goals, constraints, autonomy policy, and risks.</li><li><strong>Team-compose.</strong> Select the smallest useful specialist team and surface coverage gaps before dispatch.</li><li><strong>Plan.</strong> Write per-specialist lanes with dependencies, scope, outputs, and success criteria.</li><li><strong>Context-assemble.</strong> Build one compact task brief per specialist under <code>.guild/context/&lt;run-id&gt;/</code>.</li><li><strong>Execute-plan.</strong> Dispatch specialists through subagents by default, or agent-team when explicitly enabled.</li><li><strong>Review and verify.</strong> Consume handoff receipts, run evidence checks, and compare outputs to the approved spec.</li><li><strong>Reflect.</strong> File proposed skill or specialist improvements without auto-promoting them.</li></ol><figure class="inline-diagram"><img src="../diagrams/02-lifecycle.svg" alt="Guild task lifecycle diagram"></figure>`)}
            ${docSection("specialists", "Roster", "Thirteen specialists, composed per task", `<div class="stat-grid compact-stats"><article><span>7</span><p>Engineering roles: architect, researcher, backend, devops, qa, mobile, security.</p></article><article><span>4</span><p>Content roles: copywriter, technical-writer, social-media, seo.</p></article><article><span>2</span><p>Commercial roles: marketing and sales.</p></article></div><p>The recommended default is 3-4 specialists, with a hard cap of 6 unless the user explicitly allows a larger team. The full live roster is generated in the <a href="../reference/">Reference</a>.</p>`)}
            ${docSection("context", "Context assembly", "Three layers, one specialist brief", `<div class="table-wrap"><table><thead><tr><th>Layer</th><th>Contents</th><th>Budget</th></tr></thead><tbody><tr><td>Universal</td><td>Guild principles, project overview, current goals.</td><td>About 400 tokens</td></tr><tr><td>Role-dependent</td><td>Role standards, relevant entities, product notes.</td><td>About 800-1500 tokens</td></tr><tr><td>Task-dependent</td><td>Plan lane, named refs, upstream contracts, active decisions.</td><td>About 800-1500 tokens</td></tr></tbody></table></div><p>The target is roughly 3k tokens per specialist bundle, with a 6k hard cap. The bundle is a context contract rather than a hard security boundary.</p>`)}
            ${docSection("memory", "Project memory", "Raw sources stay separate from synthesized knowledge", `<p>Guild stores mutable project-local state under <code>.guild/</code>. Raw inputs are immutable and checksum-friendly; wiki pages promote useful knowledge with source references, confidence, and category. Decisions are captured when specialists ask questions and get answers.</p><figure class="inline-diagram"><img src="../diagrams/05-wiki.svg" alt="Guild project memory diagram"></figure>`)}
            ${docSection("evolution", "Self-evolution", "Skills change only through evidence gates", `<p>Guild evolves through automatic reflection accumulation or explicit <code>/guild:evolve</code>. Proposed behavior is compared against current behavior, summarized in a flip report, replayed in shadow mode, and promoted only when the evidence clears the gate.</p><figure class="inline-diagram"><img src="../diagrams/03-evolution.svg" alt="Guild self-evolution pipeline diagram"></figure>`)}
            ${docSection("state", "Runtime state", "What Guild writes in a consuming repo", `<pre><code>.guild/
├── raw/                 # immutable source inputs + checksums
├── wiki/                # synthesized memory, decisions, standards
├── spec/                # approved specs
├── plan/                # per-task plans
├── team/                # resolved specialist teams
├── context/             # per-run specialist context bundles
├── runs/                # telemetry, handoff receipts, assumptions
├── reflections/         # proposed skill and specialist edits
├── evolve/              # shadow-mode eval runs and reports
└── skill-versions/      # rollback snapshots</code></pre><div class="callout"><strong>Source of truth:</strong> the detailed design remains in <a href="https://github.com/lookatitude/guild/blob/main/guild-plan.md">guild-plan.md</a>; this page is the public operating guide.</div>`)}
          </div>
        </div>
      </section>
    </main>`,
  });
}

function docSection(id, eyebrow, title, content) {
  return `<section class="doc-section" id="${id}"><p class="eyebrow">${eyebrow}</p><h2>${title}</h2>${content}</section>`;
}

function renderReference(catalog) {
  const groups = groupBy(catalog.skills, (skill) => skill.tier);
  const tierOrder = ["core", "meta", "knowledge", "fallback", "specialists"];

  return layout({
    title: "Guild Reference",
    description: "Generated reference for Guild commands, specialist agents, and skills.",
    canonicalPath: "reference/",
    active: "reference",
    prefix: "../",
    pageType: "article",
    body: `    <main>
      <section class="page-hero">
        <div class="section-shell">
          <p class="eyebrow">Reference</p>
          <h1>Commands, agents, and skills</h1>
          <p class="lede">This page is generated from the repository so the public reference follows the plugin as it changes.</p>
          <div class="stat-grid reference-stats"><article><span>${catalog.commands.length}</span><p>slash commands</p></article><article><span>${catalog.agents.length}</span><p>specialist agents</p></article><article><span>${catalog.skills.length}</span><p>skills across five tiers</p></article></div>
        </div>
      </section>
      <section class="doc-page">
        <div class="doc-layout">
          <aside class="content-nav" aria-label="Reference sections">
            <a href="#commands">Commands</a><a href="#agents">Agents</a><a href="#skills">Skills</a>
          </aside>
          <div class="doc-content">
            ${docSection("commands", "Commands", "Slash command surface", `<div class="reference-grid">${catalog.commands.map(renderCommandCard).join("")}</div>`)}
            ${docSection("agents", "Agents", "Specialist roster", `<div class="reference-grid">${catalog.agents.map(renderAgentCard).join("")}</div>`)}
            ${docSection("skills", "Skills", "Skill catalog", tierOrder.map((tier) => renderSkillGroup(tier, groups.get(tier) || [])).join(""))}
          </div>
        </div>
      </section>
    </main>`,
  });
}

function renderCommandCard(command) {
  return `<article class="reference-card"><p class="eyebrow">${escapeHtml(command.file)}</p><h3><code>${escapeHtml(command.display)}</code></h3><p>${escapeHtml(command.description)}</p>${command.argumentHint ? `<p class="meta-line">Arguments: <code>${escapeHtml(command.argumentHint)}</code></p>` : ""}</article>`;
}

function renderAgentCard(agent) {
  return `<article class="reference-card"><p class="eyebrow">${escapeHtml(agent.file)}</p><h3>${escapeHtml(agent.name)}</h3><p>${escapeHtml(agent.description)}</p><p class="meta-line">Model: <code>${escapeHtml(agent.model)}</code></p><div class="tag-list">${agent.skills.map((skill) => `<span>${escapeHtml(skill)}</span>`).join("")}</div></article>`;
}

function renderSkillGroup(tier, skills) {
  return `<section class="catalog-group" id="skills-${tier}"><h3>${escapeHtml(tier)} skills <span>${skills.length}</span></h3><div class="catalog-list">${skills.map(renderSkillRow).join("")}</div></section>`;
}

function renderSkillRow(skill) {
  return `<article class="catalog-row"><div><h4>${escapeHtml(skill.name)}</h4><p>${escapeHtml(skill.description || skill.whenToUse)}</p></div><code>${escapeHtml(skill.dir)}</code></article>`;
}

function groupBy(items, getKey) {
  const map = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function renderUseCase() {
  return layout({
    title: "Guild Use Case: URL Shortener E2E Run",
    description: "A detailed Guild end-to-end use case: URL shortener microservice, approved plan, agent outputs, final result, verification output, and live run results.",
    canonicalPath: "use-cases/url-shortener-e2e.html",
    active: "use-case",
    prefix: "../",
    pageType: "article",
    body: `    <main>
      <section class="page-hero case-hero">
        <div class="section-shell">
          <p class="eyebrow">Use case</p>
          <h1>Guild builds and verifies a URL shortener</h1>
          <p class="lede">A live v1.0.0-beta4 run took one non-trivial brief through Guild's lifecycle: planning, specialist dispatch, code, docs, tests, verification, telemetry, and reflection.</p>
          <div class="hero-actions"><a class="button primary" href="#plan-vs-actual">Plan vs actual</a><a class="button secondary" href="../docs/">Read the docs</a></div>
        </div>
      </section>
      <section class="doc-page">
        <div class="doc-layout">
          <aside class="content-nav" aria-label="Use case sections">
            <a href="#brief">Brief</a><a href="#team">Team</a><a href="#plan-vs-actual">Plan vs actual</a><a href="#end-result">End result</a><a href="#results">Verification</a><a href="#reflection">Reflection</a>
          </aside>
          <div class="doc-content">
            ${docSection("brief", "Scenario", "The user brief", `<p>The test used a URL-shortener microservice brief because it forced engineering, QA, technical documentation, and conversion copy into one task without becoming a toy example.</p><pre><code>Build a URL-shortener microservice: HTTP API to shorten and resolve URLs,
SQLite storage for the MVP with a migration path to Postgres, safety checks
against malicious redirects, a compact admin endpoint that lists recent links,
Jest + property-based tests for the hash function, Markdown API docs suitable
for a README, and a short landing-page hero block with the product name and
value prop.</code></pre><div class="callout"><strong>Tested version:</strong> Guild v1.0.0-beta4, against a sibling workspace named <code>guild-test-urlshortener</code>. This page is the public narrative distilled from the internal run notes.</div>`)}
            ${docSection("team", "Specialist DAG", "Five specialists, scoped by dependency", `<div class="table-wrap"><table><thead><tr><th>Specialist</th><th>Planned ownership</th><th>Dependency</th></tr></thead><tbody><tr><td>architect</td><td>System design, hash strategy, schema, blocklist placement, admin separation, ADR.</td><td>None</td></tr><tr><td>backend</td><td>Express app, SQLite data layer, blocklist enforcement, admin endpoint.</td><td>architect</td></tr><tr><td>qa</td><td>Jest suite and property-based tests for the short-code hash.</td><td>backend</td></tr><tr><td>technical-writer</td><td>Markdown API docs and README walkthrough.</td><td>backend</td></tr><tr><td>copywriter</td><td>Landing-page hero name, value proposition, and CTA.</td><td>Spec only</td></tr></tbody></table></div><pre><code>architect  -> backend -> qa
                      -> technical-writer
copywriter -> spec-only, parallel with engineering</code></pre><p>Guild did not add security as a separate specialist because the MVP had no external integration, no secrets design, and only a simple bearer-token admin path.</p>`)}
            ${docSection("plan-vs-actual", "Execution trace", "Plan vs what the agents did", `<div class="table-wrap"><table><thead><tr><th>Lane</th><th>Plan</th><th>What the agent did</th><th>Evidence</th></tr></thead><tbody>${planRows().join("")}</tbody></table></div><p>The important part is not that every lane improvised nothing; it is that every deviation was captured in receipts and reviewed later. The architect/backend service-module mismatch became the reflection signal described below.</p>`)}
            ${docSection("end-result", "End result", "What existed after the run", `<div class="artifact-grid"><article><h3>Project files</h3><p>Runtime, data layer, migrations, route handlers, tests, API docs, README, and landing hero copy.</p><pre><code>src/app.js
src/data/sqlite.js
src/routes/shorten.js
src/routes/resolve.js
src/routes/admin.js
test/shortcode.property.test.js
test/routes.integration.test.js
docs/api.md
docs/landing-hero.md</code></pre></article><article><h3>Guild artifacts</h3><p>Spec, team, plan, context bundles, specialist handoffs, assumptions, review, verify, reflection, and telemetry.</p><pre><code>.guild/context/&lt;run-id&gt;/*.md
.guild/runs/&lt;run-id&gt;/handoffs/*.md
.guild/runs/&lt;run-id&gt;/review.md
.guild/runs/&lt;run-id&gt;/verify.md
.guild/reflections/run-&lt;id&gt;.md
.guild/runs/&lt;run-id&gt;/events.ndjson</code></pre></article></div>`)}
            ${docSection("results", "Verification", "Verification output", `<div class="table-wrap"><table><thead><tr><th>Metric</th><th>Result</th></tr></thead><tbody><tr><td>Specialists dispatched</td><td>5 / 5</td></tr><tr><td>Handoff receipts produced</td><td>5 / 5</td></tr><tr><td>Review lanes passing both stages</td><td>5 / 5</td></tr><tr><td>Verify checks green</td><td>5 / 5</td></tr><tr><td><code>npm test</code></td><td>8 / 8 tests pass in 0.625s</td></tr><tr><td>Runtime LOC</td><td>193 / 500 cap</td></tr><tr><td>Guild artifacts on disk</td><td>20 under <code>.guild/</code></td></tr><tr><td>Telemetry events captured</td><td>93 in <code>events.ndjson</code></td></tr><tr><td>Context bundle total size</td><td>13.6 KB across 5 specialists</td></tr></tbody></table></div><h3>Test and curl evidence</h3><pre><code>PASS test/routes.integration.test.js
PASS test/shortcode.property.test.js
Test Suites: 2 passed, 2 total
Tests:       8 passed, 8 total
Time:        0.625 s

POST /shorten          -> 201 {"code":"iV3wO0R", ...}
GET /:code             -> 302
GET /admin/links       -> 401
GET /admin/links auth  -> 200</code></pre><p>Verify also checked blocklist behavior, SQLite migration presence, standard HTTP status codes, documentation coverage, and changed-file scope traceability.</p>`)}
            ${docSection("reflection", "Self-evolution signal", "The run produced a real improvement candidate", `<p>Reflection found silent contract drift between the architect's design and the plan deliverables. The architect proposed a separate service module; the deliverables list did not reserve it. Backend resolved the ambiguity conservatively, but the mismatch was real.</p><div class="callout"><strong>Proposed improvement:</strong> have context assembly detect plan/design deliverable mismatches and flag them in the specialist bundle before execution.</div><p>Guild classified the finding as a <code>guild:plan</code> or context-assembly improvement candidate rather than blaming a specialist. It stayed in proposal form, below the promotion threshold, as the self-evolution gate requires.</p>`)}
          </div>
        </div>
      </section>
    </main>`,
  });
}

function planRows() {
  const rows = [
    ["architect", "Design boundaries, schema, hash strategy, blocklist placement, admin separation, ADR.", "Produced the design and ADR, including a short-code strategy and module boundary recommendation.", "Design doc, ADR, architect handoff receipt."],
    ["backend", "Implement Express API, better-sqlite3 storage, blocklist behavior, admin endpoint.", "Built runtime routes, SQLite store, migration, blocklist checks, admin auth, and server entrypoint within the LOC cap.", "Runtime files, migration, backend handoff receipt."],
    ["qa", "Write Jest and property-based tests for hash behavior and route regressions.", "Added property tests and integration tests covering shorten, resolve, blocklist, and admin behavior.", "2 test files, 8/8 tests passing."],
    ["technical-writer", "Write API docs suitable for README use.", "Documented endpoints, curl examples, schemas, errors, setup, and admin token behavior.", "README and docs/api.md."],
    ["copywriter", "Write a compact landing-page hero block with product name and value prop.", "Created the Shortlane hero, 17-word value prop, and CTA.", "docs/landing-hero.md."],
  ];
  return rows.map((cells) => `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`);
}

async function writePage(file, html) {
  const absolute = path.join(siteRoot, file);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, html);
}

async function main() {
  const catalog = await loadCatalog();
  await writePage("index.html", renderHome(catalog));
  await writePage("docs/index.html", renderDocs(catalog));
  await writePage("reference/index.html", renderReference(catalog));
  await writePage("use-cases/url-shortener-e2e.html", renderUseCase(catalog));
  console.log(`Generated Guild site: ${catalog.commands.length} commands, ${catalog.agents.length} agents, ${catalog.skills.length} skills.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
