/**
 * Exclusion tier (spec §4 step 1). Transfers, ATM withdrawals and cash advances
 * are returned explicitly as `transfer` / `excluded: true` / confidence 1.0 —
 * not dropped — so the caller decides whether to ignore them. Highest priority
 * so a transfer is never mistaken for spend.
 *
 * The code set and patterns are a conservative seed. REPLACEABLE: extend from
 * real Kanopi statement/open-banking exclusion codes and merchant strings.
 */
import type { CategoriseInput } from "./types.js";

/** Source-category codes that mark a non-expense transfer (spec §4: TNFC/OTFD). */
export const EXCLUSION_CODES: ReadonlySet<string> = new Set(["TNFC", "OTFD"]);

/**
 * Description patterns for transfers / ATM / cash advances. Word-boundaried so
 * ordinary merchant names are not swept up. Bare `\bTRANSFER\b` / `\bTFR\b` per
 * ext-002 §2's verbatim exclusion regex (ext-004 §2): `paypal transfer` and the
 * like must terminate the chain before any LLM enqueue, so the cache never fills
 * with transfer/withdrawal noise. Bare TRANSFER subsumes the earlier
 * TO/FROM / FUNDS / INTERNAL variants.
 */
export const EXCLUSION_PATTERNS: readonly RegExp[] = [
  /\b(?:TRANSFER|TFR)\b/,
  /\bWITHDRAWAL\b/,
  /\bCASH\s+ADV(?:ANCE)?\b/,
  /\bATM\b/,
  /\bCASH\s+OUT\b/,
  /\bBPAY\b/,
];

/**
 * True when the transaction is an exclusion (transfer/ATM/cash-advance). Checks
 * the source category code first (cheapest, most reliable), then the raw
 * description patterns.
 */
export function isExclusion(input: CategoriseInput): boolean {
  const code = input.source_category_code?.trim().toUpperCase();
  if (code && EXCLUSION_CODES.has(code)) return true;

  const desc = (input.description ?? "").toUpperCase();
  return EXCLUSION_PATTERNS.some((re) => re.test(desc));
}
