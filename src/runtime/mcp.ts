/**
 * src/runtime/mcp.ts — the ONE Guild MCP binary (KTD3), compiled to
 * `runtime/guild-mcp.js` by scripts/compile.ts.
 *
 * Two D-MCP ids and no third: `wiki` (guild-memory) and `trace`
 * (guild-telemetry). Their read-only KTD16 read paths are declared per server
 * in `.mcp.json` (`mcp_capability.read_paths`). Each id delegates to its server
 * module, so the stdio transport, ready line and fatal handler stay what they
 * were.
 *
 * Usage:
 *   node runtime/guild-mcp.js <wiki|trace>                 serve one id over stdio
 *   node runtime/guild-mcp.js --describe                   tool descriptions (the pin oracle)
 *   node runtime/guild-mcp.js --call <id> <tool> [json]    in-process fallback
 *
 * `--call` is the missing-mcp-rung path (KTD28): the same registered tool runs
 * in this process through the SDK's own validate + execute steps, with no MCP
 * transport. The caller records the MCP path as skip-recorded.
 */

import {
  buildServer as buildWiki,
  runAsEntry as runWiki,
} from "./mcp/guild-memory/index";
import {
  buildServer as buildTrace,
  runAsEntry as runTrace,
} from "./mcp/guild-telemetry/index";

/** The closed D-MCP id list. A third id is a failed review (KTD3). */
export const MCP_IDS = Object.freeze(["wiki", "trace"] as const);
export type McpId = (typeof MCP_IDS)[number];

interface Entry {
  server: string;
  build: () => unknown;
  run: () => void;
}

const REGISTRY: Readonly<Record<McpId, Entry>> = Object.freeze({
  wiki: { server: "guild-memory", build: buildWiki, run: runWiki },
  trace: { server: "guild-telemetry", build: buildTrace, run: runTrace },
});

export function isMcpId(value: unknown): value is McpId {
  return typeof value === "string" && (MCP_IDS as readonly string[]).includes(value);
}

/** The MCP server name each id serves, for manifests and fixtures. */
export function mcpServerFor(id: McpId): { server: string } {
  return { server: REGISTRY[id].server };
}

interface RegisteredTool {
  description?: string;
  enabled?: boolean;
}
interface ToolServer {
  _registeredTools?: Record<string, RegisteredTool>;
  validateToolInput(tool: RegisteredTool, args: unknown, name: string): Promise<unknown>;
  executeToolHandler(tool: RegisteredTool, args: unknown, extra: unknown): Promise<unknown>;
}

function registeredTools(id: McpId): Record<string, RegisteredTool> {
  const tools = (REGISTRY[id].build() as ToolServer)._registeredTools;
  if (!tools || Object.keys(tools).length === 0) {
    throw new Error(`[guild-mcp] no registered tools for "${id}" — SDK shape changed`);
  }
  return tools;
}

/** Tool name -> description, per id. The compile step pins these (KTD60). */
export function describeMcp(): Record<McpId, { server: string; tools: Record<string, string> }> {
  const out = {} as Record<McpId, { server: string; tools: Record<string, string> }>;
  for (const id of MCP_IDS) {
    const tools: Record<string, string> = {};
    for (const [name, def] of Object.entries(registeredTools(id))) {
      tools[name] = typeof def?.description === "string" ? def.description : "";
    }
    out[id] = { server: REGISTRY[id].server, tools };
  }
  return out;
}

/**
 * The in-process fallback: run one registered tool without an MCP transport.
 * Input is validated and the handler executed by the SDK's own call path, so
 * the answer is the one the MCP server would have returned.
 */
export async function callInProcess(id: McpId, tool: string, args: unknown): Promise<unknown> {
  if (!isMcpId(id)) throw new Error(`unknown D-MCP id "${String(id)}" (closed: ${MCP_IDS.join("|")})`);
  const server = REGISTRY[id].build() as ToolServer;
  const registered = server._registeredTools?.[tool];
  if (!registered) throw new Error(`[guild-mcp] ${id} has no tool "${tool}"`);
  if (registered.enabled === false) throw new Error(`[guild-mcp] ${id} tool "${tool}" is disabled`);
  const validated = await server.validateToolInput(registered, args ?? {}, tool);
  const controller = new AbortController();
  return server.executeToolHandler(registered, validated, {
    signal: controller.signal,
    requestId: 0,
    sendNotification: async () => {},
    sendRequest: async () => {
      throw new Error("in-process fallback cannot issue MCP requests");
    },
  });
}

function usage(): never {
  process.stderr.write(`[guild-mcp] usage: guild-mcp <${MCP_IDS.join("|")}> | --describe | --call <id> <tool> [json]\n`);
  process.exit(2);
}

export function main(argv: readonly string[]): void {
  const [arg, ...rest] = argv;
  if (arg === "--describe") {
    process.stdout.write(JSON.stringify(describeMcp(), null, 2) + "\n");
    return;
  }
  if (arg === "--call") {
    const [id, tool, json] = rest;
    if (!isMcpId(id) || !tool) usage();
    let args: unknown = {};
    try {
      args = json ? JSON.parse(json) : {};
    } catch {
      process.stderr.write("[guild-mcp] --call: arguments are not JSON\n");
      process.exit(2);
    }
    callInProcess(id, tool, args).then(
      (result) => process.stdout.write(JSON.stringify(result) + "\n"),
      (err: unknown) => {
        process.stderr.write(`[guild-mcp] --call failed: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      },
    );
    return;
  }
  if (!isMcpId(arg)) usage();
  REGISTRY[arg].run();
}

if (require.main === module) main(process.argv.slice(2));
