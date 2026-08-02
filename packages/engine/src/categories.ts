/**
 * Category constants for structural engine code (decision §9.1; reconciled by
 * ext-002).
 *
 * Originally this held placeholder `__pending__` sentinels because the verbatim
 * Kanopi taxonomy was a blocked input. ext-002 delivered the 15-category
 * taxonomy, so every constant is now bound to a real taxonomy id. The MCC table,
 * rules and fallback reference `CATEGORY.*` — never a raw string — so this file
 * remains the single source of truth for category ids.
 *
 * Concepts the MCC table needs that have no home in taxonomy v1 (retail, travel,
 * personal care, government, etc.) resolve to `other_expenses` — the discretionary
 * catch-all (ext-002 §5, deviation 4). The reconciliation guard
 * (`reconcileCategories`, test/categories.test.ts) asserts every value is a real
 * category id and that no `__pending__` sentinel remains.
 */
import { isValidCategory } from "@moroku-enrich/taxonomy";

/** Prefix marking an unresolved placeholder — none remain after ext-002. */
export const PENDING_PREFIX = "__pending__:";

/** True if `id` is an unresolved placeholder sentinel rather than a real id. */
export function isPendingCategory(id: string): boolean {
  return id.startsWith(PENDING_PREFIX);
}

/**
 * The single source of truth for category ids used by structural engine code.
 * All 15 verbatim taxonomy ids (ext-002 §1). Structural aliases needed by the
 * MCC table but absent from taxonomy v1 map to `other_expenses`.
 */
export const CATEGORY = {
  MORTGAGE: "mortgage",
  RENT: "rent",
  LOAN_REPAYMENT: "loan_repayment",
  GROCERIES: "groceries",
  UTILITIES: "utilities",
  VEHICLE_RUNNING: "vehicle_running",
  TRANSPORT: "transport",
  INSURANCE: "insurance",
  STRATA: "strata",
  EDUCATION: "education",
  SUBSCRIPTIONS: "subscriptions",
  DINING_ENTERTAINMENT: "dining_entertainment",
  CLOTHING: "clothing",
  HEALTHCARE: "healthcare",
  OTHER_EXPENSES: "other_expenses",
} as const;

/** A category id as referenced by engine code. */
export type CategoryRef = (typeof CATEGORY)[keyof typeof CATEGORY];

/** Every registry value, for reconciliation. */
export const ALL_PLACEHOLDER_CATEGORIES: readonly string[] = Object.values(CATEGORY);

/**
 * Reconcile the registry against the authoritative taxonomy. Returns any
 * unresolved sentinels (`pending`) and any bound values that are NOT real
 * category ids (`invalid`). After ext-002 both must be empty — the tripwire
 * enforced by test/categories.test.ts. A handler can call this at cold start.
 */
export function reconcileCategories(): { pending: string[]; invalid: string[] } {
  const pendingLeft: string[] = [];
  const invalid: string[] = [];
  for (const value of ALL_PLACEHOLDER_CATEGORIES) {
    if (isPendingCategory(value)) {
      pendingLeft.push(value);
      continue;
    }
    if (!isValidCategory(value)) invalid.push(value);
  }
  return { pending: pendingLeft, invalid };
}
