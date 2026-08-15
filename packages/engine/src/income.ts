/**
 * Income recognition (ext-006) — spec §2's `income` outcome, pulled forward
 * from phase 2.
 *
 * Applies to credits only, and only after the exclusion tier has had its say,
 * so an internal transfer or a savings movement is never mistaken for earnings.
 * A credit that matches nothing here keeps returning `uncategorised_credit`
 * exactly as before: recognition is strictly additive, and silence is the
 * default.
 *
 * `excluded: true` on the result — income is not spend and must stay out of the
 * `confident_pct` and fallback-rate denominators — but unlike an anonymous
 * credit it is now nameable, which is what makes an income denominator
 * computable downstream.
 *
 * The cue set is deliberately conservative and Australian. Over-recognising
 * income flatters affordability (spec §1.3), so a cue earns its place only if a
 * false positive is implausible: `SALARY`, `PAYROLL` and the named benefit
 * agencies are unambiguous on a credit; `DIRECT CREDIT`, `DEPOSIT` and bare
 * `PAY` are not, and are excluded on purpose. Extend from real traffic, the
 * same way the rules tier grew.
 */
import { NON_EXPENSE } from "./categories.js";
import type { CategoriseInput } from "./types.js";
import type { NormalisedMerchant } from "./normaliser.js";

/**
 * Confidence stamped on a recognised income credit. Above the 0.8
 * low-confidence threshold: these cues are explicit, not inferred.
 */
export const INCOME_CONFIDENCE = 0.9;

export interface IncomeRule {
  /** Stable id for audit / tests. */
  id: string;
  pattern: RegExp;
}

/**
 * Ordered income cues, matched against the lowercased haystack
 * (source_category_description + normalised merchant key), word-boundaried.
 */
export const INCOME_RULES: readonly IncomeRule[] = [
  { id: "I1-salary", pattern: /\b(salary|salaries)\b/ },
  { id: "I2-payroll", pattern: /\b(payroll|pay ?run|payrun)\b/ },
  { id: "I3-wages", pattern: /\b(wages|wage payment)\b/ },
  {
    id: "I4-benefits",
    pattern:
      /\b(centrelink|services australia|jobseeker|youth allowance|austudy|abstudy|family tax benefit|paid parental leave|dept veterans affairs|veterans affairs)\b/,
  },
  { id: "I5-pension", pattern: /\b(pension|superannuation payment|super payment)\b/ },
];

export interface IncomeHit {
  category: string;
  ruleId: string;
}

/**
 * Recognise an income credit. Returns `undefined` for anything unmatched — the
 * caller then falls through to `uncategorised_credit`.
 *
 * The caller is responsible for having established that this is a credit; this
 * function does not re-check the sign, so it stays a pure string matcher.
 *
 * ## Why the RAW description is in the haystack
 *
 * Unlike the rules tier, income matches the raw description as well as the
 * normalised key. The normaliser exists to collapse *merchant* strings, and it
 * strips trailing location tokens — so "SERVICES AUSTRALIA" normalises to
 * "services" and an agency cue containing a place name becomes unreachable.
 * Income payers are employers and agencies, not merchants, so the normalisation
 * that helps the dictionary actively hurts here. Both strings are searched;
 * dictionary keying is unaffected because this tier never writes a key.
 */
export function recogniseIncome(
  merchant: NormalisedMerchant,
  input: CategoriseInput,
): IncomeHit | undefined {
  const haystack = [
    input.source_category_description ?? "",
    input.description ?? "",
    merchant.match_key,
  ]
    .join(" ")
    .toLowerCase()
    .trim();

  for (const rule of INCOME_RULES) {
    if (rule.pattern.test(haystack)) {
      return { category: NON_EXPENSE.INCOME, ruleId: rule.id };
    }
  }
  return undefined;
}
