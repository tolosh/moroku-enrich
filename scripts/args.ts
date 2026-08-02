/** Minimal argv parser for the admin scripts — no external dependency. */
export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string>;
  bools: Set<string>;
}

/**
 * Parse `["name", "--plan", "internal", "--allow-external"]` into positionals,
 * `--k v` flags, and boolean `--k` flags (a flag followed by another `--flag`
 * or end-of-args is treated as boolean).
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok.startsWith("--")) {
      const name = tok.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[name] = next;
        i++;
      } else {
        bools.add(name);
      }
    } else {
      positionals.push(tok);
    }
  }
  return { positionals, flags, bools };
}

/** kebab/space → lowercase hyphenated slug for a default tenant_id. */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
