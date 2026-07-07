declare module "js-yaml" {
  export const JSON_SCHEMA: unknown;
  export const DEFAULT_SCHEMA: unknown;
  export function load(src: string, opts?: unknown): unknown;
  export function dump(value: unknown, opts?: unknown): string;
}
