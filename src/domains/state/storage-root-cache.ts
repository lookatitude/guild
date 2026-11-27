/**
 * Internal to the state domain (not re-exported from index.ts): the cache
 * subtree for one Guild root, `<cache>/roots/<rootId>`. The only place that
 * formula lives.
 */
import * as path from "node:path";
import type { GuildStorageRoots } from "./storage-roots";

export function guildRootCacheBase(roots: Pick<GuildStorageRoots, "cache">, rootId: string): string {
  return path.join(roots.cache, "roots", rootId);
}
