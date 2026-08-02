/**
 * Placeholder category constants for structural engine code (decision §9.1).
 *
 * The 16 Kanopi expense-category identifiers are a blocked input: they must be
 * lifted verbatim from Kanopi's code and must not be invented, so
 * `EXPENSE_CATEGORIES` in @moroku-enrich/taxonomy stays empty until they land.
 * But the MCC table, rules tier and fallback all need to *name* their target
 * category to be built now. This module is the sanctioned bridge:
 *
 *   - Every tier references `CATEGORY.*` — never a raw string — so when the real
 *     names arrive, only the values in THIS file change and no tier logic moves.
 *   - A few ids are given directly by the spec/kickoff and are bound now:
 *     `other_expenses` (kickoff: one of the 16, fallback bucket), `vehicle_running`
 *     (kickoff: fuel MCC target), `dining_entertainment` and `groceries` (spec §3.1
 *     examples). These are transcribed, not invented.
 *   - Every other concept the MCC table needs is a `pending(...)` sentinel — an
 *     unmistakable non-id value. It cannot be confused for a real category and
 *     cannot silently leak into an API response as a plausible-looking name.
 *
 * The reconciliation guard (`reconcileCategories`, and test/categories.test.ts)
 * asserts — once `EXPENSE_CATEGORIES` is populated — that every bound value is a
 * real category id and that no `pending(...)` sentinels remain. That is the
 * tripwire which forces this file to be finished before the engine goes live.
 */
import { isValidCategory } from "@moroku-enrich/taxonomy";

/** Prefix marking a category concept whose verbatim Kanopi id is not yet known. */
export const PENDING_PREFIX = "__pending__:";

/** Build a sentinel value for an unresolved category concept. */
function pending(concept: string): string {
  return `${PENDING_PREFIX}${concept}`;
}

/** True if `id` is an unresolved placeholder sentinel rather than a real id. */
export function isPendingCategory(id: string): boolean {
  return id.startsWith(PENDING_PREFIX);
}

/**
 * The single source of truth for category ids used by structural engine code.
 *
 * BOUND values are given by the spec/kickoff. PENDING values are placeholders to
 * be rebound to Kanopi's verbatim id when EXPENSE_CATEGORIES lands — rebinding is
 * a one-line change here; no tier logic changes.
 */
export const CATEGORY = {
  // --- Bound now (named directly in spec/kickoff) -----------------------------
  /** Fallback bucket and an ordinary category (kickoff). */
  OTHER_EXPENSES: "other_expenses",
  /** Fuel / motor running costs — kickoff: MCC 5541/5542 → vehicle_running. */
  VEHICLE_RUNNING: "vehicle_running",
  /** Restaurants, cafés, entertainment (spec §3.1 example). */
  DINING_ENTERTAINMENT: "dining_entertainment",
  /** Supermarkets / food retail (spec §3.1 example: GROC / Groceries). */
  GROCERIES: "groceries",

  // --- Pending (rebind when the verbatim 16-list lands) -----------------------
  UTILITIES: pending("utilities"),
  HEALTH_MEDICAL: pending("health_medical"),
  TRANSPORT: pending("transport"),
  TRAVEL: pending("travel"),
  SHOPPING_RETAIL: pending("shopping_retail"),
  CLOTHING: pending("clothing"),
  HOME_HARDWARE: pending("home_hardware"),
  PERSONAL_CARE: pending("personal_care"),
  EDUCATION: pending("education"),
  INSURANCE: pending("insurance"),
  PROFESSIONAL_SERVICES: pending("professional_services"),
  GOVERNMENT: pending("government"),
  CHARITY_GIFTS: pending("charity_gifts"),
} as const;

/** A category id as referenced by engine code (may be bound or pending today). */
export type CategoryRef = (typeof CATEGORY)[keyof typeof CATEGORY];

/** Every placeholder value, for reconciliation. */
export const ALL_PLACEHOLDER_CATEGORIES: readonly string[] = Object.values(CATEGORY);

/**
 * Reconcile the placeholder registry against the authoritative taxonomy.
 * Meaningful only once EXPENSE_CATEGORIES is populated. Returns any unresolved
 * sentinels (`pending`) and any bound values that are NOT real category ids
 * (`invalid`) — both must be empty before the engine is trusted in production.
 * A handler can call this at cold start to fail fast.
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
