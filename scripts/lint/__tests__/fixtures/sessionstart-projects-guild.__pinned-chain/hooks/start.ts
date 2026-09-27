import { ensureStorageLayout } from "./lib/ensure-layout";
import { bindSession, composeSessionPrompt } from "../src/domains/config/index";
import { projectSurfaces } from "../src/adapters/index";
export function main(cwd: string, env: Record<string, string>): void {
  ensureStorageLayout(cwd);
  const projection = projectSurfaces(env.GUILD_HOST_FAMILY, { verify_check_available: false });
  const composed = composeSessionPrompt({ host_family: "claude", model_family: "anthropic" });
  bindSession({ runDir: cwd, runId: "r", detected: projection as never, promptCompose: composed as never });
}
