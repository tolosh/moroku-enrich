/**
 * Rules tier (spec §4 step 5) — Kanopi's legacy regex chain, ported once into
 * the shared module as the ordered "legacy floor" (confidence 0.7). It carries
 * the fuel/cinema priority cues for MCC-less inputs (statements).
 *
 * BLOCKED INPUT: the merged Kanopi regex ruleset is being prepared and will
 * arrive later. Until then `RULES` is an empty placeholder — the tier is wired
 * end-to-end and always falls through, so priority ordering is testable now and
 * the real ruleset drops in without touching `applyRules` or the chain.
 */
import type { CategoriseInput } from "./types.js";
import type { NormalisedMerchant } from "./normaliser.js";

export interface Rule {
  /** Stable id for audit / tests. */
  id: string;
  /** Matched against the match_key and the raw description. */
  pattern: RegExp;
  /** Target category — reference CATEGORY.* from ./categories, never a literal. */
  category: string;
}

/** Confidence stamped on a rules-tier hit (spec §4 step 5). */
export const RULES_CONFIDENCE = 0.7;

/**
 * The ported Kanopi ruleset, ordered — first match wins. EMPTY until the merged
 * ruleset lands (blocked input). Do not invent rules here.
 */
export const RULES: readonly Rule[] = [];

export interface RuleHit {
  category: string;
  ruleId: string;
}

/**
 * Apply the rules chain to a normalised merchant / raw input. Returns the first
 * matching rule's category, or undefined if none match (always, for now).
 */
export function applyRules(
  merchant: NormalisedMerchant,
  input: CategoriseInput,
): RuleHit | undefined {
  const haystackKey = merchant.match_key;
  const haystackRaw = (input.description ?? "").toUpperCase();
  for (const rule of RULES) {
    if (rule.pattern.test(haystackKey) || rule.pattern.test(haystackRaw)) {
      return { category: rule.category, ruleId: rule.id };
    }
  }
  return undefined;
}
