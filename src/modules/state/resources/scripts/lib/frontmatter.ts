/**
 * Backward-compatible public entrypoint.
 *
 * Shared frontmatter/YAML parsing lives in src/modules/state so the reorg can
 * move internals without breaking imports from scripts/lib/frontmatter.
 */

import * as frontmatterImpl from "../../src/modules/state/workflows/frontmatter";

export const splitFrontmatter = frontmatterImpl.splitFrontmatter;
export const parseYaml = frontmatterImpl.parseYaml;
export const parseFrontmatter = frontmatterImpl.parseFrontmatter;
export const readFrontmatterField = frontmatterImpl.readFrontmatterField;
export const readFrontmatterString = frontmatterImpl.readFrontmatterString;
export const readScalarField = frontmatterImpl.readScalarField;
export const hasTopLevelKey = frontmatterImpl.hasTopLevelKey;
export const replaceTopLevelLine = frontmatterImpl.replaceTopLevelLine;
export type {
  FrontmatterSplit,
  ParseOpts,
} from "../../src/modules/state/workflows/frontmatter";
