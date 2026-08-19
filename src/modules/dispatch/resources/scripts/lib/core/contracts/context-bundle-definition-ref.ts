import {
  resolveHistorical,
  type AdoptionManifestV1,
  type AdoptionResolution,
} from "./adoption-manifest";
import { validateProjectDefinitionRefV1 } from "./project-definition-ref";

const REF_LINE = /^\s*definition_ref:\s*(\{.*\})\s*$/gm;
const LEGACY_AGENT = /(\/(?:[^\s"'`<>]+\/)*(?:\.guild|\.claude)\/agents\/([A-Za-z0-9][A-Za-z0-9_-]*)\.md)/g;

/** Resolve a new embedded ref or read an immutable legacy locator through history. */
export function resolveContextBundleDefinition(
  bundleText: string,
  manifest: AdoptionManifestV1,
): AdoptionResolution {
  const lines = [...bundleText.matchAll(REF_LINE)];
  if (lines.length > 0) {
    if (lines.length !== 1) return { status: "ambiguous", ref: null, trail: [] };
    try {
      const ref = validateProjectDefinitionRefV1(JSON.parse(lines[0][1]));
      return ref ? { status: "resolved", ref, trail: [] } : { status: "ambiguous", ref: null, trail: [] };
    } catch {
      return { status: "ambiguous", ref: null, trail: [] };
    }
  }
  const locators = [...bundleText.matchAll(LEGACY_AGENT)].map((match) => ({ path: match[1], id: match[2] }));
  const unique = new Map(locators.map((locator) => [`${locator.id}\0${locator.path}`, locator]));
  if (unique.size !== 1) return { status: unique.size === 0 ? "not_found" : "ambiguous", ref: null, trail: [] };
  const locator = [...unique.values()][0];
  return resolveHistorical(manifest, { kind: "agent", id: locator.id, historical_path: locator.path });
}
