/**
 * Taxonomy — @moroku-enrich/taxonomy (spec §2, decision §9.1; extended by ext-006).
 *
 * ext-002 delivered the 15 verbatim Kanopi expense categories. ext-006 extends
 * the taxonomy for Odyssey (customer #2), whose three live missions need signal
 * the Kanopi expense taxonomy does not carry:
 *
 *   + `bnpl`, `general_retail`          two expense categories (Spending)
 *   + `income`                          credit recognition (spec §2, pulled
 *                                       forward from phase 2)
 *   + `savings_deposit` / `savings_withdrawal`
 *                                       transfer subtyping (Saving)
 *
 * Per spec §2 these are ADDITIVE within taxonomy major 1 — no existing id is
 * renamed, removed or re-classified — so the version moves 1 → 1.1. Consumers
 * must tolerate ids they do not know; that is what `GET /v1/taxonomy` is for.
 *
 * The taxonomy is versioned and served by GET /v1/taxonomy so consuming apps
 * never hard-code it. Changes are additive-only within a major version.
 */

export const TAXONOMY_VERSION = "1.1";

/** The three expense classifications (spec §2). Frozen for v1. */
export const CLASSIFICATIONS = ["essential", "discretionary", "financial_commitment"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

/**
 * A taxonomy category. `default_classification` is applied when a correction or
 * mapping does not specify one (spec §3.2). `excluded` marks non-expense
 * outcomes the caller may drop (transfers).
 */
export interface CategoryDef {
  /** Stable identifier used across the API and dictionary. */
  id: string;
  /** Human-facing label for UIs and docs. */
  label: string;
  /** Applied when no classification is supplied. */
  default_classification: Classification;
  /** True for transfer / atm / cash-advance style non-expense outcomes. */
  excluded: boolean;
  /** Non-expense credit/transfer outcomes are not real expense categories. */
  kind: "expense" | "non_expense";
}

/**
 * The 17 expense categories: the 15 Kanopi originals frozen verbatim
 * (decision §9.1, corrected to 15 by ext-002 §0) plus the two ext-006 additions.
 * Identifiers for 1–15 are exactly as in Kanopi's engine; default
 * classifications are as that engine assigns them (ext-002 §1). Labels are
 * display strings only.
 *
 * Note: `other_expenses` defaults `discretionary` as a taxonomy default; the
 * conservative-fallback path still forces `essential` + `unverified` at
 * assignment time (kickoff ruling). Rule/dictionary hits on `other_expenses`
 * keep the discretionary default.
 *
 * ext-006 additions:
 * - `bnpl` — buy-now-pay-later instalments. `financial_commitment`, not
 *   discretionary: a BNPL instalment is a scheduled obligation, and reading it
 *   as discretionary would flatter affordability (spec §1.3).
 * - `general_retail` — department stores, electronics, homewares, hobby. Was
 *   the largest block inside the `other_expenses` catch-all; splitting it out
 *   makes the catch-all mean "genuinely unclassified" again. Classification is
 *   unchanged (`discretionary`), so no affordability number moves.
 */
export const EXPENSE_CATEGORIES: readonly CategoryDef[] = [
  cat("mortgage", "Mortgage", "financial_commitment"),
  cat("rent", "Rent", "financial_commitment"),
  cat("loan_repayment", "Loan Repayment", "financial_commitment"),
  cat("groceries", "Groceries", "essential"),
  cat("utilities", "Utilities", "essential"),
  cat("vehicle_running", "Vehicle Running", "essential"),
  cat("transport", "Transport", "essential"),
  cat("insurance", "Insurance", "essential"),
  cat("strata", "Strata", "essential"),
  cat("education", "Education", "essential"),
  cat("subscriptions", "Subscriptions", "discretionary"),
  cat("dining_entertainment", "Dining & Entertainment", "discretionary"),
  cat("clothing", "Clothing", "discretionary"),
  cat("healthcare", "Healthcare", "essential"),
  cat("other_expenses", "Other Expenses", "discretionary"),
  // --- ext-006 (additive) ---
  cat("bnpl", "Buy Now Pay Later", "financial_commitment"),
  cat("general_retail", "General Retail", "discretionary"),
];

function cat(
  id: string,
  label: string,
  default_classification: Classification,
): CategoryDef {
  return { id, label, default_classification, excluded: false, kind: "expense" };
}

/**
 * A non-expense outcome. All of them are `excluded` (the caller may drop them
 * from spend) and carry `essential` as an inert default — the classification
 * enum is expense-shaped and does not describe transfers, credits or income.
 */
function nonExpense(id: string, label: string): CategoryDef {
  return {
    id,
    label,
    default_classification: "essential",
    excluded: true,
    kind: "non_expense",
  };
}

/** The ext-006 savings outcomes, for callers that want the pair by name. */
export const SAVINGS_CATEGORIES = {
  DEPOSIT: "savings_deposit",
  WITHDRAWAL: "savings_withdrawal",
} as const;

/**
 * Additive non-expense outcomes today's Kanopi engine drops on the floor and
 * this service returns explicitly (spec §2). Named verbatim in the spec.
 */
export const NON_EXPENSE_OUTCOMES: readonly CategoryDef[] = [
  nonExpense("transfer", "Transfer"),
  // ext-006 deviation 1: was `excluded: false` while the chain forced
  // `excluded: true` on the credit path — so a *user override* to this id
  // resolved as spend and diluted confident_pct. Aligned to true; the chain
  // path is unchanged.
  nonExpense("uncategorised_credit", "Uncategorised Credit"),
  // --- ext-006 (additive) ---
  // Recognised salary/benefit credits (spec §2, pulled forward from phase 2).
  // Excluded: income is emphatically not spend, and must never enter the
  // confident_pct or fallback-rate denominators.
  nonExpense("income", "Income"),
  // Savings movements, subtyped out of `transfer` so a deposit is
  // distinguishable from a withdrawal. Both stay excluded — they are transfers,
  // not spend, and the spend denominators must not move.
  nonExpense("savings_deposit", "Savings Deposit"),
  nonExpense("savings_withdrawal", "Savings Withdrawal"),
];

/**
 * Expected count of expense categories: 15 verbatim Kanopi (decision §9.1,
 * corrected by ext-002 §0) + 2 additive (ext-006).
 */
export const EXPECTED_EXPENSE_CATEGORY_COUNT = 17;

/** All categories (expense + non-expense). */
export function allCategories(): readonly CategoryDef[] {
  return [...EXPENSE_CATEGORIES, ...NON_EXPENSE_OUTCOMES];
}

const CATEGORY_INDEX: ReadonlyMap<string, CategoryDef> = new Map(
  allCategories().map((c) => [c.id, c]),
);

export function getCategory(id: string): CategoryDef | undefined {
  return CATEGORY_INDEX.get(id);
}

export function isValidCategory(id: string): boolean {
  return CATEGORY_INDEX.has(id);
}

export function isValidClassification(value: string): value is Classification {
  return (CLASSIFICATIONS as readonly string[]).includes(value);
}

/**
 * The default classification for a category id, or undefined if unknown.
 * Corrections that omit `corrected_classification` fall back to this (spec §3.2).
 */
export function defaultClassificationFor(id: string): Classification | undefined {
  return CATEGORY_INDEX.get(id)?.default_classification;
}

/** The full taxonomy document served by GET /v1/taxonomy. */
export interface TaxonomyDocument {
  taxonomy_version: string;
  classifications: readonly Classification[];
  categories: readonly CategoryDef[];
}

export function taxonomyDocument(): TaxonomyDocument {
  return {
    taxonomy_version: TAXONOMY_VERSION,
    classifications: CLASSIFICATIONS,
    categories: allCategories(),
  };
}
