/**
 * scripts/check-host-mcp-claims.ts
 *
 * ISSUE #116 — compare each host entity page (wiki entities/*.md carrying
 * a `host_id:`) with HOST_REGISTRY_ROWS[<id>].capabilities.mcp, the authoritative
 * row. Violations:
 *   transport_mismatch        the page's `mcp:` block (stdio/http) differs from the row
 *   missing_unverified_label  row provenance is `inferred` but the page never says UNVERIFIED
 *                             (in the `mcp:` block or the "(7) MCP" table row)
 *   unmapped_host             page host_id has no registry row, alias, or exemption
 *
 * Prose is ADVISORY only: `advisoryProseWarnings` flags (7) MCP / FDC-13 rows that mention a
 * transport the row denies. It prints `warn:` lines and never changes the exit code.
 *
 * Usage: npx tsx check-host-mcp-claims.ts --entities <entities-dir>   (exit 1 on any violation)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { HOST_REGISTRY_ROWS } from "./lib/host-registry-schema";

export type McpRows = Record<string, { mcp: { stdio: boolean; http: boolean }; provenance: string }>;

export interface Violation {
  file: string;
  kind: "transport_mismatch" | "missing_unverified_label" | "unmapped_host";
  detail: string;
}

/** Page host_id -> registry host id, where the page uses a different spelling. */
export const DEFAULT_ALIASES: Record<string, string> = {
  "claude-code-desktop": "claude-code-app",
  "antigravity-2": "antigravity-cli",
  pi: "pi-cli",
};

/** Pages for hosts that have no registry row. gemini-cli was sunset 2026-06-14 (replaced by antigravity). */
export const DEFAULT_EXEMPT: readonly string[] = Object.freeze(["gemini-cli"]);

export interface CheckOpts {
  entitiesDir: string;
  rows?: McpRows;
  aliases?: Record<string, string>;
  exempt?: readonly string[];
}

function registryRows(): McpRows {
  const out: McpRows = {};
  for (const [id, r] of Object.entries(HOST_REGISTRY_ROWS as Record<string, any>)) {
    out[id] = { mcp: { stdio: r.capabilities.mcp.stdio, http: r.capabilities.mcp.http }, provenance: r.provenance };
  }
  return out;
}

function mcpBlock(text: string): { stdio?: boolean; http?: boolean; raw: string } {
  const m = /^mcp:\s*\n((?:[ \t]+.*\n?)+)/m.exec(text);
  const raw = m ? m[1] : "";
  const pick = (k: string): boolean | undefined => {
    const r = new RegExp(`^[ \\t]+${k}:\\s*(true|false)\\b`, "m").exec(raw);
    return r ? r[1] === "true" : undefined;
  };
  return { stdio: pick("stdio"), http: pick("http"), raw };
}

function tableRows(text: string, label: RegExp): string[] {
  return text.split("\n").filter((l) => l.startsWith("|") && label.test(l.split("|")[1] ?? ""));
}

export function checkHostMcpClaims(opts: CheckOpts): Violation[] {
  const rows = opts.rows ?? registryRows();
  const aliases = opts.aliases ?? DEFAULT_ALIASES;
  const exempt = opts.exempt ?? DEFAULT_EXEMPT;
  const out: Violation[] = [];

  for (const file of fs.readdirSync(opts.entitiesDir).filter((f) => f.endsWith(".md")).sort()) {
    const text = fs.readFileSync(path.join(opts.entitiesDir, file), "utf8");
    const hid = /^host_id:\s*"?([^"\s]+)"?/m.exec(text)?.[1];
    if (!hid) continue;
    if (exempt.includes(hid)) continue;
    const row = rows[aliases[hid] ?? hid];
    if (!row) {
      out.push({ file, kind: "unmapped_host", detail: `host_id "${hid}" has no registry row, alias, or exemption` });
      continue;
    }

    const block = mcpBlock(text);
    for (const t of ["stdio", "http"] as const) {
      if (block[t] !== row.mcp[t]) {
        out.push({
          file,
          kind: "transport_mismatch",
          detail: `${t}: page says ${String(block[t])}, registry row says ${row.mcp[t]}`,
        });
      }
    }

    const mcpRow = tableRows(text, /\(7\)\s*MCP/);
    if (row.provenance === "inferred") {
      const labelled = /UNVERIFIED/.test(block.raw) || mcpRow.some((l) => /UNVERIFIED/.test(l));
      if (!labelled) {
        out.push({ file, kind: "missing_unverified_label", detail: "registry row provenance is inferred; page must say UNVERIFIED" });
      }
    }
  }
  return out;
}

export function advisoryProseWarnings(opts: CheckOpts): Violation[] {
  const rows = opts.rows ?? registryRows();
  const aliases = opts.aliases ?? DEFAULT_ALIASES;
  const exempt = opts.exempt ?? DEFAULT_EXEMPT;
  const out: Violation[] = [];
  for (const file of fs.readdirSync(opts.entitiesDir).filter((f) => f.endsWith(".md")).sort()) {
    const text = fs.readFileSync(path.join(opts.entitiesDir, file), "utf8");
    const hid = /^host_id:\s*"?([^"\s]+)"?/m.exec(text)?.[1];
    if (!hid || exempt.includes(hid)) continue;
    const row = rows[aliases[hid] ?? hid];
    if (!row) continue;
    for (const l of [...tableRows(text, /\(7\)\s*MCP/), ...tableRows(text, /FDC-13/)]) {
      // Only the first two cells (surface + what Guild implements); later cells are requirement/notes.
      const claim = l.split("|").slice(1, 3).join(" ");
      for (const t of ["stdio", "http"] as const) {
        if (!row.mcp[t] && new RegExp(`\\b${t}\\b`, "i").test(claim)) {
          out.push({ file, kind: "transport_mismatch", detail: `${t}: row says ${row.mcp[t]} but prose says: ${l.slice(0, 100)}` });
        }
      }
    }
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf("--entities");
  const dir = i >= 0 ? process.argv[i + 1] : undefined;
  if (!dir) {
    console.error("usage: check-host-mcp-claims.ts --entities <entities-dir>");
    process.exit(2);
  }
  const v = checkHostMcpClaims({ entitiesDir: dir });
  for (const x of v) console.error(`${x.file}: ${x.kind}: ${x.detail}`);
  for (const w of advisoryProseWarnings({ entitiesDir: dir })) console.error(`warn: ${w.file}: ${w.detail}`);
  console.log(`check-host-mcp-claims: ${v.length} violation(s)`);
  process.exit(v.length === 0 ? 0 : 1);
}
