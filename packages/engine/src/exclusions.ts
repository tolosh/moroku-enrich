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

/** Cash-withdrawal forms, for the venue proxy below (ext-008 §7). */
const CASH_WITHDRAWAL_PATTERNS: readonly RegExp[] = [
  /\bWITHDRAWAL\b/,
  /\bATM\b/,
  /\bCASH\s+OUT\b/,
];

/** Licensed-venue cues — a known proxy for poker-machine spend (ext-008 §7). */
export const VENUE_CASH_CUE = /\b(?:HOTEL|RSL|LEAGUES|TAVERN|CLUB)\b/;

/**
 * True for an ATM / cash withdrawal at a licensed venue (hotel / RSL / leagues /
 * tavern / club) — a known proxy for poker-machine spend. The chain keeps the
 * excluded `transfer` outcome but attaches a low-confidence
 * `venue_cash_withdrawal` flag (ext-008 §7): we flag rather than reclassify, so
 * ordinary ATM traffic is untouched.
 */
export function isVenueCashWithdrawal(input: CategoriseInput): boolean {
  const desc = (input.description ?? "").toUpperCase();
  return CASH_WITHDRAWAL_PATTERNS.some((re) => re.test(desc)) && VENUE_CASH_CUE.test(desc);
}
