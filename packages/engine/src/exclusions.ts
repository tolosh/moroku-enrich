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
 * Description patterns for transfers / ATM / cash advances. Kept deliberately
 * tight (word-boundaried) so ordinary merchant names are not swept up.
 */
export const EXCLUSION_PATTERNS: readonly RegExp[] = [
  /\bATM\b/,
  /\bCASH\s+ADV(?:ANCE)?\b/,
  /\bCASH\s+OUT\b/,
  /\bINT(?:ERNAL)?\s+(?:TFR|TRANSFER)\b/,
  /\bTRANSFER\s+(?:TO|FROM)\b/,
  /\bE?FUNDS?\s+TRANSFER\b/,
  /\bBPAY\b/,
  /\bWITHDRAWAL\b/,
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
